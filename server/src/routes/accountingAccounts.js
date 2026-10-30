import { Router } from 'express';
import pool from '../db/pool.js';
import { isUuid } from '../lib/ids.js';
import { parseAccountBody } from '../validation/accounting.js';

const router = Router();
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

const ACCOUNT_COLUMNS = `
  a.id,
  a.code,
  a.name,
  a.type,
  a.parent_id AS "parentId",
  a.is_system AS "isSystem",
  a.is_active AS "isActive",
  COALESCE(l.posted_lines, 0)::int AS "postedLineCount"
`;

const ACCOUNT_FROM = `
  FROM acct_accounts a
  LEFT JOIN (
    SELECT l.account_id, count(*) AS posted_lines
    FROM acct_journal_lines l
    JOIN acct_journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
    GROUP BY l.account_id
  ) l ON l.account_id = a.id
`;

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(404).json({
      error: 'Account not found.',
      code: 'NOT_FOUND',
      params: { entity: 'account' },
    });
  }
  next();
});

router.get('/', async (req, res) => {
  const includeInactive = req.query.includeInactive === '1';
  const result = await pool.query(
    `SELECT ${ACCOUNT_COLUMNS}
     ${ACCOUNT_FROM}
     WHERE ${includeInactive ? 'TRUE' : 'a.is_active'}
     ORDER BY a.code`
  );
  res.json({ accounts: result.rows });
});

router.post('/', async (req, res) => {
  const parsed = parseAccountBody(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  try {
    const created = await pool.query(
      `INSERT INTO acct_accounts (code, name, type, parent_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        parsed.value.code,
        parsed.value.name,
        parsed.value.type,
        parsed.value.parentId ?? null,
      ]
    );
    const full = await pool.query(
      `SELECT ${ACCOUNT_COLUMNS} ${ACCOUNT_FROM} WHERE a.id = $1`,
      [created.rows[0].id]
    );
    res.status(201).json({ account: full.rows[0] });
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION && err.constraint === 'acct_accounts_code_unique') {
      return res.status(409).json({
        error: 'An account with that code already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    if (err.code === FOREIGN_KEY_VIOLATION) {
      return res.status(400).json({
        error: 'Parent account not found.',
        code: 'NOT_FOUND',
        params: { entity: 'account' },
      });
    }
    if (err.code === CHECK_VIOLATION && /hierarchy/.test(String(err.message))) {
      return res.status(409).json({
        error: 'An account cannot be moved under one of its subaccounts.',
        code: 'ACCOUNTING_ACCOUNT_CYCLE',
      });
    }
    throw err;
  }
});

router.patch('/:id', async (req, res) => {
  const parsed = parseAccountBody(req.body ?? {}, { partial: true });
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const existing = await pool.query(
    'SELECT id, code, type, is_system AS "isSystem", parent_id AS "parentId" FROM acct_accounts WHERE id = $1',
    [req.params.id]
  );
  if (existing.rowCount === 0) {
    return res.status(404).json({
      error: 'Account not found.',
      code: 'NOT_FOUND',
      params: { entity: 'account' },
    });
  }
  const current = existing.rows[0];

  if ('parentId' in parsed.value && parsed.value.parentId !== null) {
    if (parsed.value.parentId === current.id) {
      return res.status(400).json({
        error: 'An account cannot be its own parent.',
        code: 'ACCOUNTING_ACCOUNT_CYCLE',
      });
    }
    const descendants = await pool.query(
      `WITH RECURSIVE sub AS (
         SELECT id FROM acct_accounts WHERE parent_id = $1
         UNION ALL
         SELECT a.id FROM acct_accounts a JOIN sub s ON a.parent_id = s.id
       )
       SELECT 1 FROM sub WHERE id = $2 LIMIT 1`,
      [current.id, parsed.value.parentId]
    );
    if (descendants.rowCount > 0) {
      return res.status(400).json({
        error: 'An account cannot be moved under one of its subaccounts.',
        code: 'ACCOUNTING_ACCOUNT_CYCLE',
      });
    }
  }
  // The seeded accounts carry the auto-posting mappings; their code and type
  // are the anchors the engine reads, so they stay put.
  if (current.isSystem && ('code' in parsed.value || 'type' in parsed.value)) {
    const nextCode = 'code' in parsed.value ? parsed.value.code : current.code;
    const nextType = 'type' in parsed.value ? parsed.value.type : current.type;
    if (nextCode !== current.code || nextType !== current.type) {
      return res.status(400).json({
        error: 'System accounts keep their code and type.',
        code: 'ACCOUNTING_ACCOUNT_IMMUTABLE',
      });
    }
  }

  const sets = [];
  const values = [];
  const columns = {
    code: 'code',
    name: 'name',
    type: 'type',
    parentId: 'parent_id',
    isActive: 'is_active',
  };
  for (const [key, column] of Object.entries(columns)) {
    if (key in parsed.value) {
      values.push(parsed.value[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  values.push(req.params.id);
  try {
    await pool.query(
      `UPDATE acct_accounts SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING id`,
      values
    );
    const full = await pool.query(
      `SELECT ${ACCOUNT_COLUMNS} ${ACCOUNT_FROM} WHERE a.id = $1`,
      [req.params.id]
    );
    res.json({ account: full.rows[0] });
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION && err.constraint === 'acct_accounts_code_unique') {
      return res.status(409).json({
        error: 'An account with that code already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    if (err.code === FOREIGN_KEY_VIOLATION) {
      return res.status(400).json({
        error: 'Parent account not found.',
        code: 'NOT_FOUND',
        params: { entity: 'account' },
      });
    }
    if (err.code === CHECK_VIOLATION && /hierarchy/.test(String(err.message))) {
      return res.status(409).json({
        error: 'An account cannot be moved under one of its subaccounts.',
        code: 'ACCOUNTING_ACCOUNT_CYCLE',
      });
    }
    throw err;
  }
});

// Deactivate, never delete: posted lines RESTRICT removal anyway.
router.delete('/:id', async (req, res) => {
  const existing = await pool.query(
    'SELECT is_system AS "isSystem" FROM acct_accounts WHERE id = $1',
    [req.params.id]
  );
  if (existing.rowCount === 0) {
    return res.status(404).json({
      error: 'Account not found.',
      code: 'NOT_FOUND',
      params: { entity: 'account' },
    });
  }
  if (existing.rows[0].isSystem) {
    return res.status(400).json({
      error: 'System accounts cannot be removed; deactivate instead.',
      code: 'ACCOUNTING_ACCOUNT_IMMUTABLE',
    });
  }
  await pool.query(
    'UPDATE acct_accounts SET is_active = false WHERE id = $1 AND is_active',
    [req.params.id]
  );
  res.status(204).end();
});

export default router;
