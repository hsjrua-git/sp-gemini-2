import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import {
  closeFiscalPeriod,
  generateOpeningEntry,
} from '../lib/accountingJournal.js';
import { requirePermission } from '../middleware/auth.js';
import { isUuid } from '../lib/ids.js';
import { isValidIsoDate } from '../lib/periods.js';
import { parsePeriodBody } from '../validation/accounting.js';

const router = Router();
const EXCLUSION_VIOLATION = '23P01';

const PERIOD_COLUMNS = `
  p.id,
  p.name,
  p.start_date::text AS "startDate",
  p.end_date::text   AS "endDate",
  p.status,
  p.closed_at  AS "closedAt",
  (SELECT count(*)::int FROM acct_journal_entries e
    WHERE e.status = 'posted'
      AND e.entry_date BETWEEN p.start_date AND p.end_date) AS "postedEntryCount"
`;

// Overlapping periods would make "which period does this date belong to"
// ambiguous — refuse them (checked in-process and enforced by DB trigger).
async function overlaps(db, { startDate, endDate, exceptId = null }) {
  const result = await db.query(
    `SELECT id FROM acct_fiscal_periods
     WHERE daterange(start_date, end_date, '[]') && daterange($1::date, $2::date, '[]')
       AND ($3::uuid IS NULL OR id <> $3::uuid)
     LIMIT 1`,
    [startDate, endDate, exceptId]
  );
  return result.rowCount > 0;
}

router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT ${PERIOD_COLUMNS}
     FROM acct_fiscal_periods p
     ORDER BY p.start_date DESC`
  );
  res.json({ periods: result.rows });
});

router.post('/', async (req, res) => {
  const parsed = parsePeriodBody(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  if (await overlaps(pool, parsed.value)) {
    return res.status(409).json({
      error: 'That range overlaps another fiscal period.',
      code: 'ACCOUNTING_PERIOD_OVERLAP',
    });
  }
  try {
    const result = await pool.query(
      `INSERT INTO acct_fiscal_periods (name, start_date, end_date)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [parsed.value.name, parsed.value.startDate, parsed.value.endDate]
    );
    const full = await pool.query(
      `SELECT ${PERIOD_COLUMNS} FROM acct_fiscal_periods p WHERE p.id = $1`,
      [result.rows[0].id]
    );
    res.status(201).json({ period: full.rows[0] });
  } catch (err) {
    if (err.code === EXCLUSION_VIOLATION) {
      return res.status(409).json({
        error: 'That range overlaps another fiscal period.',
        code: 'ACCOUNTING_PERIOD_OVERLAP',
      });
    }
    throw err;
  }
});

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(404).json({
      error: 'Period not found.',
      code: 'NOT_FOUND',
      params: { entity: 'period' },
    });
  }
  next();
});

router.patch('/:id', async (req, res) => {
  const parsed = parsePeriodBody(req.body ?? {}, { partial: true });
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  const current = await pool.query(
    `SELECT id, status, start_date::text AS "startDate", end_date::text AS "endDate"
     FROM acct_fiscal_periods WHERE id = $1`,
    [req.params.id]
  );
  if (current.rowCount === 0) {
    return res.status(404).json({
      error: 'Period not found.',
      code: 'NOT_FOUND',
      params: { entity: 'period' },
    });
  }
  if (current.rows[0].status === 'closed') {
    return res.status(409).json({
      error: 'Closed periods cannot be edited; reopen first.',
      code: 'ACCOUNTING_PERIOD_CLOSED',
    });
  }
  const next = {
    startDate: parsed.value.startDate ?? current.rows[0].startDate,
    endDate: parsed.value.endDate ?? current.rows[0].endDate,
  };
  if (next.startDate > next.endDate) {
    return res.status(400).json({
      error: 'The period cannot end before it starts.',
      code: 'ACCOUNTING_PERIOD_RANGE',
    });
  }
  if (await overlaps(pool, { ...next, exceptId: req.params.id })) {
    return res.status(409).json({
      error: 'That range overlaps another fiscal period.',
      code: 'ACCOUNTING_PERIOD_OVERLAP',
    });
  }

  const sets = [];
  const values = [];
  const columns = { name: 'name', startDate: 'start_date', endDate: 'end_date' };
  for (const [key, column] of Object.entries(columns)) {
    if (key in parsed.value) {
      values.push(parsed.value[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  values.push(req.params.id);
  try {
    await pool.query(
      `UPDATE acct_fiscal_periods SET ${sets.join(', ')} WHERE id = $${values.length}`,
      values
    );
  } catch (err) {
    if (err.code === EXCLUSION_VIOLATION) {
      return res.status(409).json({
        error: 'That range overlaps another fiscal period.',
        code: 'ACCOUNTING_PERIOD_OVERLAP',
      });
    }
    throw err;
  }
  const full = await pool.query(
    `SELECT ${PERIOD_COLUMNS} FROM acct_fiscal_periods p WHERE p.id = $1`,
    [req.params.id]
  );
  res.json({ period: full.rows[0] });
});

// Closing a period books the automatic closing entry (income and expense
// balances zeroed into retained earnings) and locks the range against
// further posting. Reopening is allowed — the closing entry stays posted and
// immutable; late postings land after it.
router.post('/:id/close', requirePermission('accounting.close'), async (req, res) => {
  const client = await pool.connect();
  let closed;
  try {
    await client.query('BEGIN');
    closed = await closeFiscalPeriod(client, {
      user: req.user,
      periodId: req.params.id,
    });
    if (closed.error) {
      await client.query('ROLLBACK');
      const status = closed.error === 'NOT_FOUND' ? 404 : 409;
      const message =
        closed.error === 'NOT_FOUND'
          ? 'Period not found.'
          : 'That period is already closed.';
      return res.status(status).json({ error: message, code: closed.error });
    }
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'accounting_period.close',
      entityType: 'acct_fiscal_period',
      details: { periodId: req.params.id, closingLines: closed.closingLines },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const full = await pool.query(
    `SELECT ${PERIOD_COLUMNS} FROM acct_fiscal_periods p WHERE p.id = $1`,
    [req.params.id]
  );
  res.json({ period: full.rows[0] });
});

router.post('/:id/reopen', requirePermission('accounting.close'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE acct_fiscal_periods
       SET status = 'open', closed_by = NULL, closed_at = NULL
       WHERE id = $1 AND status = 'closed'
       RETURNING id`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Only closed periods can be reopened.',
        code: 'ACCOUNTING_PERIOD_OPEN',
      });
    }
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'accounting_period.reopen',
      entityType: 'acct_fiscal_period',
      details: { periodId: req.params.id },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const full = await pool.query(
    `SELECT ${PERIOD_COLUMNS} FROM acct_fiscal_periods p WHERE p.id = $1`,
    [req.params.id]
  );
  res.json({ period: full.rows[0] });
});

// The adopt-accounting snapshot: today's cafe inventory + student balances
// onto the books as a posted opening entry (once ever).
router.get('/opening', async (req, res) => {
  const result = await pool.query(
    `SELECT id, entry_no AS "entryNo", entry_date::text AS "entryDate", status,
            (SELECT COALESCE(SUM(debit), 0) FROM acct_journal_lines WHERE entry_id = e.id)::bigint AS total
     FROM acct_journal_entries e
     WHERE e.source_type = 'opening'
     ORDER BY e.created_at DESC LIMIT 1`
  );
  res.json({ opening: result.rows[0] ?? null });
});

router.post('/opening', async (req, res) => {
  const date = req.body?.date;
  if (!isValidIsoDate(date)) {
    return res.status(400).json({
      error: 'date must be a date (YYYY-MM-DD).',
      code: 'VALIDATION_INVALID_DATE',
    });
  }
  const client = await pool.connect();
  let created;
  try {
    await client.query('BEGIN');
    created = await generateOpeningEntry(client, { user: req.user, date });
    if (created.error) {
      await client.query('ROLLBACK');
      const messages = {
        ACCOUNTING_OPENING_EXISTS: 'The opening entry already exists.',
        ACCOUNTING_NOTHING_TO_OPEN:
          'There is nothing to put on the books (no stock, no balances).',
        ACCOUNTING_PERIOD_CLOSED: 'The entry falls in a closed fiscal period.',
      };
      return res.status(409).json({
        error: messages[created.error] ?? 'Could not create the opening entry.',
        code: created.error,
      });
    }
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'accounting.opening_balance',
      entityType: 'acct_journal_entry',
      details: {
        entryId: created.entryId,
        entryNo: created.entryNo,
        date,
        total: created.total,
      },
    });
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
  res.status(201).json({ opening: created });
});

export default router;
