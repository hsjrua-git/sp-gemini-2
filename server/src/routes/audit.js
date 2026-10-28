import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

const CATEGORIES = [
  'student',
  'parameter',
  'teacher',
  'interval',
  'assignment',
  'session',
  'task',
  'task_template',
  'alert',
  'settings',
  'scores',
  'evaluation',
  'user',
  'role',
  'group',
  'field',
  'field_definition',
  'cafe',
  'cafe_product',
  'cafe_supplier',
  'cafe_purchase',
  'cafe_sale',
  'cafe_inventory',
  'cafe_waste',
  'cafe_adjustment',
  'cafe_balance',
  'accounting',
  'accounting_account',
  'accounting_mapping',
  'accounting_entry',
  'accounting_period',
  'agent',
  'auth',
  'api',
];

const CATEGORY_PREFIXES = {
  cafe_inventory: ['cafe_inventory', 'cafe_waste', 'cafe_adjustment'],
  accounting: ['accounting', 'accounting_account', 'accounting_mapping', 'accounting_entry'],
  scores: ['scores', 'evaluation'],
  field: ['field', 'field_definition'],
};
const PAGE_SIZE = 25;
const MAX_DETAIL_CHANGES = 50;

function toPositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

router.get('/', async (req, res) => {
  const { category, actor } = req.query;
  const page = Math.min(toPositiveInt(req.query.page, 1), 100000);

  const conditions = [];
  const values = [];

  if (category !== undefined) {
    if (typeof category !== 'string' || !CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: 'Unknown category.',
        code: 'VALIDATION_INVALID_CHOICE',
        params: { field: 'category' },
      });
    }
    const prefixes = CATEGORY_PREFIXES[category] ?? [category];
    values.push(prefixes);
    conditions.push(`split_part(a.action, '.', 1) = ANY($${values.length}::text[])`);
  }
  if (actor !== undefined) {
    if (typeof actor !== 'string' || actor === '' || actor.length > 64) {
      return res.status(400).json({
        error: 'Invalid user filter.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'actor' },
      });
    }
    values.push(actor.toLowerCase());
    conditions.push(`lower(a.actor) = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countResult, listResult] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total FROM audit_log a ${where}`, values),
    pool.query(
      `SELECT a.id::text        AS id,
              a.occurred_at     AS "occurredAt",
              a.actor,
              a.action,
              a.entity_type     AS "entityType",
              a.entity_id       AS "entityId",
              a.details,
              a.old_data        AS "oldData",
              a.new_data        AS "newData",
              s.full_name       AS "studentName",
              s.student_code    AS "studentCode",
              p.name            AS "parameterName"
       FROM audit_log a
       LEFT JOIN students s
         ON a.entity_type = 'student' AND s.id::text = a.entity_id
       LEFT JOIN parameters p
         ON a.entity_type = 'parameter' AND p.id::text = a.entity_id
       ${where}
       ORDER BY a.occurred_at DESC, a.id DESC
       LIMIT ${PAGE_SIZE} OFFSET $${values.length + 1}`,
      [...values, (page - 1) * PAGE_SIZE]
    ),
  ]);

  const entries = listResult.rows.map((row) => {
    const changes = row.details?.changes;
    if (Array.isArray(changes) && changes.length > MAX_DETAIL_CHANGES) {
      return {
        ...row,
        details: {
          ...row.details,
          changes: changes.slice(0, MAX_DETAIL_CHANGES),
          moreChanges: changes.length - MAX_DETAIL_CHANGES,
        },
      };
    }
    return row;
  });

  res.json({
    entries,
    total: countResult.rows[0].total,
    page,
    pageSize: PAGE_SIZE,
  });
});

export default router;