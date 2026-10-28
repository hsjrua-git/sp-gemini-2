import { Router } from 'express';
import pool from '../db/pool.js';
import { createSale, voidSale } from '../lib/cafeSale.js';
import { isUuid } from '../lib/ids.js';
import { isValidIsoDate } from '../lib/periods.js';
import { parseSaleBody } from '../validation/cafe.js';

const router = Router();
const MAX_LISTED = 200;

const SALE_COLUMNS = `
  sa.id,
  sa.sold_at              AS "soldAt",
  u.username              AS "soldBy",
  sa.customer,
  sa.student_id           AS "studentId",
  sf.full_name            AS "studentName",
  sf.student_code        AS "studentCode",
  sa.total,
  sa.cost_total           AS "costTotal",
  sa.note,
  sa.voided_at            AS "voidedAt",
  COALESCE(i.items, '[]') AS items
`;

const SALE_FROM = `
  FROM cafe_sales sa
  JOIN users u ON u.id = sa.sold_by
  LEFT JOIN students sf ON sf.id = sa.student_id
  LEFT JOIN (
    SELECT si.sale_id,
           json_agg(json_build_object(
             'id', si.id,
             'productId', si.product_id,
             'productName', p.name,
             'qty', si.qty,
             'unitPrice', si.unit_price,
             'unitCost', si.unit_cost
           ) ORDER BY p.name) AS items
    FROM cafe_sale_items si
    JOIN cafe_products p ON p.id = si.product_id
    GROUP BY si.sale_id
  ) i ON i.sale_id = sa.id
`;

router.get('/', async (req, res) => {
  const { studentId, from, to } = req.query;
  const includeVoided = req.query.includeVoided === '1';

  const conditions = [includeVoided ? 'TRUE' : 'sa.voided_at IS NULL'];
  const values = [];
  const push = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (studentId !== undefined) {
    if (!isUuid(studentId)) {
      return res.status(400).json({
        error: 'studentId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
      });
    }
    conditions.push(`sa.student_id = ${push(studentId)}`);
  }
  if (from !== undefined) {
    if (!isValidIsoDate(from)) {
      return res.status(400).json({
        error: 'from must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
      });
    }
    conditions.push(`sa.sold_at >= ${push(from)}::date`);
  }
  if (to !== undefined) {
    if (!isValidIsoDate(to)) {
      return res.status(400).json({
        error: 'to must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
      });
    }
    conditions.push(`sa.sold_at < (${push(to)}::date + 1)`);
  }

  const result = await pool.query(
    `SELECT ${SALE_COLUMNS}
     ${SALE_FROM}
     WHERE ${conditions.join(' AND ')}
     ORDER BY sa.sold_at DESC
     LIMIT ${MAX_LISTED + 1}`
  , values);
  res.json({
    sales: result.rows.slice(0, MAX_LISTED),
    truncated: result.rows.length > MAX_LISTED,
  });
});

// Prices default to the product's current price; a student charge may push
// the balance negative (overdraft is allowed by design).
router.post('/', async (req, res) => {
  const parsed = parseSaleBody(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const client = await pool.connect();
  let created;
  try {
    await client.query('BEGIN');
    created = await createSale(client, {
      user: req.user,
      ...parsed.value,
    });
    if (created.error) {
      await client.query('ROLLBACK');
      const status = created.error === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json({
        error:
          created.error === 'CAFE_STUDENT_INACTIVE'
            ? 'That student does not exist.'
            : 'Every item must name an active product.',
        code: created.error,
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (/closed fiscal period/i.test(String(err?.message))) {
      return res.status(409).json({
        error: 'The entry falls in a closed fiscal period.',
        code: 'ACCOUNTING_PERIOD_CLOSED',
      });
    }
    throw err;
  } finally {
    client.release();
  }

  const full = await pool.query(
    `SELECT ${SALE_COLUMNS} ${SALE_FROM} WHERE sa.id = $1`,
    [created.saleId]
  );
  const payload = { ...full.rows[0] };
  if (created.balanceAfter !== null) payload.balanceAfter = created.balanceAfter;
  res.status(201).json({ sale: payload });
});

// Voiding reverses everything — stock comes back, a student's balance is
// refunded — and the sale row is marked, never deleted.
router.post('/:id/void', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({
      error: 'Sale not found.',
      code: 'NOT_FOUND',
      params: { entity: 'sale' },
    });
  }

  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    result = await voidSale(client, { user: req.user, saleId: req.params.id });
    if (result.error) {
      await client.query('ROLLBACK');
      const status = result.error === 'NOT_FOUND' ? 404 : 409;
      const messages = {
        NOT_FOUND: 'Sale not found.',
        ACCOUNTING_PERIOD_CLOSED: 'The entry falls in a closed fiscal period.',
      };
      const message = messages[result.error] ?? 'That sale is already voided.';
      return res.status(status).json({ error: message, code: result.error });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (/closed fiscal period/i.test(String(err?.message))) {
      return res.status(409).json({
        error: 'The entry falls in a closed fiscal period.',
        code: 'ACCOUNTING_PERIOD_CLOSED',
      });
    }
    throw err;
  } finally {
    client.release();
  }

  res.status(201).json({ voided: true, balanceAfter: result.balanceAfter });
});

export default router;
