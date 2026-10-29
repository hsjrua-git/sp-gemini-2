import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { postMappedEvent } from '../lib/accountingJournal.js';
import { isUuid } from '../lib/ids.js';
import { moneyNumber } from '../lib/money.js';
import { parseInventoryBody } from '../validation/cafeInventory.js';

const router = Router();
const MAX_MOVEMENTS = 100;

// Current stock per product (the cafe_stock view) with the movement history
// beside it. Readable by cafe.view; writes below need cafe.inventory.
router.get('/', async (req, res) => {
  const stock = await pool.query(
    `SELECT product_id          AS "productId",
            name               AS "productName",
            is_active          AS "isActive",
            avg_cost           AS "avgCost",
            qty::float8        AS qty,
            (qty * avg_cost)::bigint AS "value"
     FROM cafe_stock
     ORDER BY is_active DESC, lower(name)`
  );

  const movements = await pool.query(
    `SELECT m.id,
            p.name                AS "productName",
            m.kind,
            m.qty::float8         AS qty,
            m.unit_cost           AS "unitCost",
            m.reference_type     AS "referenceType",
            m.reference_id       AS "referenceId",
            m.note,
            u.username           AS "createdBy",
            m.created_at         AS "createdAt"
     FROM cafe_stock_movements m
     JOIN cafe_products p ON p.id = m.product_id
     JOIN users u ON u.id = m.created_by
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT ${MAX_MOVEMENTS + 1}`
  );

  res.json({
    stock: stock.rows,
    movements: movements.rows.slice(0, MAX_MOVEMENTS),
    truncated: movements.rows.length > MAX_MOVEMENTS,
  });
});

router.param('productId', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(400).json({
      error: 'productId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
    });
  }
  next();
});

// One product's full movement ledger (stock card).
router.get('/:productId', async (req, res) => {
  const product = await pool.query(
    `SELECT id, name, is_active AS "isActive", avg_cost AS "avgCost"
     FROM cafe_products WHERE id = $1`,
    [req.params.productId]
  );
  if (product.rowCount === 0) {
    return res.status(404).json({
      error: 'Product not found.',
      code: 'NOT_FOUND',
      params: { entity: 'product' },
    });
  }

  const movements = await pool.query(
    `SELECT m.id,
            m.kind,
            m.qty::float8    AS qty,
            m.unit_cost      AS "unitCost",
            m.reference_type AS "referenceType",
            m.reference_id   AS "referenceId",
            m.note,
            u.username       AS "createdBy",
            m.created_at     AS "createdAt",
            SUM(m.qty) OVER (ORDER BY m.created_at, m.id)::float8 AS "runningQty"
     FROM cafe_stock_movements m
     JOIN users u ON u.id = m.created_by
     WHERE m.product_id = $1
     ORDER BY m.created_at, m.id`,
    [req.params.productId]
  );

  const totals = await pool.query(
    `SELECT COALESCE(SUM(qty), 0)::float8 AS qty FROM cafe_stock WHERE product_id = $1`,
    [req.params.productId]
  );

  res.json({
    product: product.rows[0],
    qty: totals.rows[0].qty,
    movements: movements.rows,
  });
});

// Record waste or an adjustment: new append-only movements in one
// transaction. Waste snapshots the current average cost so the loss is
// valued at reports time; adjustments are valued at 0 (they correct the
// count, not the goods).
router.post('/', async (req, res) => {
  const parsed = parseInventoryBody(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  const { kind, items, note } = parsed.value;
  const productIds = items.map((item) => item.productId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const products = await client.query(
      `SELECT id, avg_cost FROM cafe_products
       WHERE id = ANY($1::uuid[]) AND is_active
       ORDER BY id
       FOR UPDATE`,
      [productIds]
    );
    const byId = new Map(
      products.rows.map((row) => [
        row.id,
        moneyNumber(row.avg_cost, 'Average cost'),
      ])
    );
    if (byId.size !== new Set(productIds).size) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Every item must name an active product.',
        code: 'CAFE_PRODUCT_INACTIVE',
      });
    }

    // Value the persisted decimal quantities, rounding the transaction total
    // once in PostgreSQL rather than multiplying money in binary floating point.
    const movementValue = await client.query(
      `WITH inserted AS (
        INSERT INTO cafe_stock_movements
         (product_id, kind, qty, unit_cost, note, created_by)
       SELECT x.product_id, $1, x.qty * $2, x.cost, $3, $4
       FROM unnest($5::uuid[], $6::numeric[], $7::bigint[])
          AS x(product_id, qty, cost)
        RETURNING qty, unit_cost
       )
       SELECT COALESCE(SUM(-qty * unit_cost), 0)::bigint AS value FROM inserted`,
      [
        kind,
        kind === 'waste' ? -1 : 1,
        note,
        req.user.id,
        items.map((item) => item.productId),
        // Waste is entered positive and stored negative; adjustments keep
        // their sign (found extra = +, missing = -).
        items.map((item) => (kind === 'waste' ? Math.abs(item.qty) : item.qty)),
        items.map((item) => (kind === 'waste' ? byId.get(item.productId) : 0)),
      ]
    );

    // Waste is a loss valued at the current average cost — auto-post the
    // pair (Dr expenses / Cr inventory) when the mapping is active.
    if (kind === 'waste') {
      const wasteValue = moneyNumber(
        movementValue.rows[0].value,
        'Waste value'
      );
      if (wasteValue > 0) {
        await postMappedEvent(client, {
          user: req.user,
          sourceType: 'cafe_waste',
          sourceId: randomUUID(),
          date: null,
          memo: 'Cafe waste',
          pairs: [{ event: 'cafe.waste', amount: wasteValue }],
        });
      }
    }

    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: `cafe_${kind}.create`,
      entityType: 'cafe_movement',
      details: {
        kind,
        itemCount: items.length,
        lines: items.map((item) => ({
          productId: item.productId,
          qty: kind === 'waste' ? -Math.abs(item.qty) : item.qty,
        })),
      },
    });

    await client.query('COMMIT');
    res.status(201).json({ recorded: items.length });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;
