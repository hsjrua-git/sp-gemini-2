import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { postMappedEvent } from '../lib/accountingJournal.js';
import { updateAverageCost } from '../lib/cafeStock.js';
import { isUuid } from '../lib/ids.js';
import { moneyNumber } from '../lib/money.js';
import { isValidIsoDate } from '../lib/periods.js';
import { parsePurchaseBody } from '../validation/cafe.js';

const router = Router();
const MAX_LISTED = 200;

// A purchase is one transaction: the purchase row, its items, the stock
// movements, and the product's moving-average cost all commit together or
// not at all. Products are locked FOR UPDATE so concurrent purchases of the
// same product compute their averages from a consistent stock.
const PURCHASE_COLUMNS = `
  pu.id,
  pu.supplier_id            AS "supplierId",
  s.name                    AS "supplierName",
  pu.note,
  pu.purchased_at           AS "purchasedAt",
  pu.created_by             AS "createdBy",
  pu.created_at             AS "createdAt",
  COALESCE(i.items, '[]')   AS items,
  COALESCE(i.total, 0)      AS total
`;

const PURCHASE_FROM = `
  FROM cafe_purchases pu
  JOIN cafe_suppliers s ON s.id = pu.supplier_id
  LEFT JOIN (
    SELECT pi.purchase_id,
           json_agg(json_build_object(
             'id', pi.id,
             'productId', pi.product_id,
             'productName', p.name,
             'qty', pi.qty,
             'unitCost', pi.unit_cost
           ) ORDER BY p.name) AS items,
           SUM(pi.qty * pi.unit_cost) AS total
    FROM cafe_purchase_items pi
    JOIN cafe_products p ON p.id = pi.product_id
    GROUP BY pi.purchase_id
  ) i ON i.purchase_id = pu.id
`;

router.get('/', async (req, res) => {
  const { supplierId, from, to } = req.query;
  const conditions = ['TRUE'];
  const values = [];
  const push = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (supplierId !== undefined) {
    if (!isUuid(supplierId)) {
      return res.status(400).json({
        error: 'supplierId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
      });
    }
    conditions.push(`pu.supplier_id = ${push(supplierId)}`);
  }
  if (from !== undefined) {
    if (!isValidIsoDate(from)) {
      return res.status(400).json({
        error: 'from must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
      });
    }
    conditions.push(`pu.purchased_at >= ${push(from)}::date`);
  }
  if (to !== undefined) {
    if (!isValidIsoDate(to)) {
      return res.status(400).json({
        error: 'to must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
      });
    }
    conditions.push(`pu.purchased_at <= ${push(to)}::date`);
  }

  const result = await pool.query(
    `SELECT ${PURCHASE_COLUMNS}
     ${PURCHASE_FROM}
     WHERE ${conditions.join(' AND ')}
     ORDER BY pu.purchased_at DESC, pu.created_at DESC
     LIMIT ${MAX_LISTED + 1}`,
    values
  );
  res.json({
    purchases: result.rows.slice(0, MAX_LISTED),
    truncated: result.rows.length > MAX_LISTED,
  });
});

router.post('/', async (req, res) => {
  const parsed = parsePurchaseBody(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  const { supplierId, note, purchasedAt, items } = parsed.value;
  const productIds = items.map((item) => item.productId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const supplier = await client.query(
      'SELECT id FROM cafe_suppliers WHERE id = $1 AND is_active',
      [supplierId]
    );
    if (supplier.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Choose an active supplier.',
        code: 'CAFE_SUPPLIER_INACTIVE',
      });
    }

    // Lock every touched product row, in a stable order to avoid deadlocks
    // between concurrent purchases.
    const locked = await client.query(
      `SELECT id FROM cafe_products
       WHERE id = ANY($1::uuid[]) AND is_active
       ORDER BY id
       FOR UPDATE`,
      [productIds]
    );
    if (locked.rowCount !== new Set(productIds).size) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Every item must name an active product.',
        code: 'CAFE_PRODUCT_INACTIVE',
      });
    }

    const purchase = await client.query(
      `INSERT INTO cafe_purchases (supplier_id, note, purchased_at, created_by)
       VALUES ($1, $2, COALESCE($3::date, current_date), $4)
       RETURNING id`,
      [supplierId, note ?? null, purchasedAt ?? null, req.user.id]
    );
    const purchaseId = purchase.rows[0].id;

    await client.query(
      `INSERT INTO cafe_purchase_items (purchase_id, product_id, qty, unit_cost)
       SELECT $1, x.product_id, x.qty, x.unit_cost
       FROM unnest($2::uuid[], $3::numeric[], $4::bigint[]) AS x(product_id, qty, unit_cost)`,
      [
        purchaseId,
        items.map((item) => item.productId),
        items.map((item) => item.qty),
        items.map((item) => item.unitCost),
      ]
    );

    await client.query(
      `INSERT INTO cafe_stock_movements
         (product_id, kind, qty, unit_cost, reference_type, reference_id, created_by)
       SELECT x.product_id, 'purchase', x.qty, x.unit_cost, 'purchase', $1, $2
       FROM unnest($3::uuid[], $4::numeric[], $5::bigint[]) AS x(product_id, qty, unit_cost)`,
      [
        purchaseId,
        req.user.id,
        items.map((item) => item.productId),
        items.map((item) => item.qty),
        items.map((item) => item.unitCost),
      ]
    );

    // Moving average from the prior stock weighted with this delivery
    // (lib/cafeStock.js holds the math — the smoke test exercises the same
    // function).
    await updateAverageCost(client, purchaseId);

    const totals = await client.query(
      `SELECT COALESCE(SUM(qty * unit_cost), 0)::bigint AS total
       FROM cafe_purchase_items WHERE purchase_id = $1`,
      [purchaseId]
    );
    const purchaseTotal = moneyNumber(totals.rows[0].total, 'Purchase total');

    // Auto-post Dr Inventory / Cr Cash when the mapping is active — inside
    // the same transaction as the purchase itself.
    await postMappedEvent(client, {
      user: req.user,
      sourceType: 'cafe_purchase',
      sourceId: purchaseId,
      date: purchasedAt ?? null,
      memo: 'Cafe purchase',
      pairs: [{ event: 'cafe.purchase', amount: purchaseTotal }],
    });

    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'cafe_purchase.create',
      entityType: 'cafe_purchase',
      details: {
        purchaseId,
        supplierId,
        itemCount: items.length,
        total: purchaseTotal,
      },
    });

    await client.query('COMMIT');

    const full = await client.query(
      `SELECT ${PURCHASE_COLUMNS} ${PURCHASE_FROM} WHERE pu.id = $1`,
      [purchaseId]
    );
    res.status(201).json({ purchase: full.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;
