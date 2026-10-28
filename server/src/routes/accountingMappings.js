import { Router } from 'express';
import pool from '../db/pool.js';
import { parseMappingBody } from '../validation/accounting.js';

const router = Router();
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

// The cafe→journal mapping table: which events auto-post, and against which
// account pair. Readable with accounting.view (the journal explains itself);
// editable with accounting.manage.
const MAPPING_COLUMNS = `
  m.id,
  m.event,
  m.debit_account_id  AS "debitAccountId",
  m.credit_account_id AS "creditAccountId",
  m.is_active         AS "isActive",
  da.code             AS "debitCode",
  da.name             AS "debitName",
  ca.code             AS "creditCode",
  ca.name             AS "creditName"
`;

router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT ${MAPPING_COLUMNS}
     FROM acct_mappings m
     JOIN acct_accounts da ON da.id = m.debit_account_id
     JOIN acct_accounts ca ON ca.id = m.credit_account_id
     ORDER BY m.event`
  );
  res.json({ mappings: result.rows });
});

router.patch('/:event', async (req, res) => {
  const parsed = parseMappingBody(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const current = await pool.query(
    `SELECT debit_account_id AS "debitAccountId",
            credit_account_id AS "creditAccountId"
     FROM acct_mappings WHERE event = $1`,
    [req.params.event]
  );
  if (current.rowCount === 0) {
    return res.status(404).json({
      error: 'Unknown mapping event.',
      code: 'NOT_FOUND',
      params: { entity: 'mapping' },
    });
  }
  const nextDebit = parsed.value.debitAccountId ?? current.rows[0].debitAccountId;
  const nextCredit = parsed.value.creditAccountId ?? current.rows[0].creditAccountId;
  if (nextDebit === nextCredit) {
    return res.status(400).json({
      error: 'Debit and credit accounts must be different.',
      code: 'ACCOUNTING_MAPPING_SAME_ACCOUNT',
    });
  }

  const sets = [];
  const values = [];
  const columns = {
    debitAccountId: 'debit_account_id',
    creditAccountId: 'credit_account_id',
    isActive: 'is_active',
  };
  for (const [key, column] of Object.entries(columns)) {
    if (key in parsed.value) {
      values.push(parsed.value[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  values.push(req.params.event);
  try {
    const result = await pool.query(
      `UPDATE acct_mappings SET ${sets.join(', ')}
       WHERE event = $${values.length}
       RETURNING id`,
      values
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Unknown mapping event.',
        code: 'NOT_FOUND',
        params: { entity: 'mapping' },
      });
    }
  } catch (err) {
    if (err.code === FOREIGN_KEY_VIOLATION) {
      return res.status(400).json({
        error: 'Account not found.',
        code: 'NOT_FOUND',
        params: { entity: 'account' },
      });
    }
    if (err.code === CHECK_VIOLATION) {
      return res.status(400).json({
        error: 'Debit and credit accounts must be different.',
        code: 'ACCOUNTING_MAPPING_SAME_ACCOUNT',
      });
    }
    throw err;
  }
  const full = await pool.query(
    `SELECT ${MAPPING_COLUMNS}
     FROM acct_mappings m
     JOIN acct_accounts da ON da.id = m.debit_account_id
     JOIN acct_accounts ca ON ca.id = m.credit_account_id
     WHERE m.event = $1`,
    [req.params.event]
  );
  res.json({ mapping: full.rows[0] });
});

export default router;
