import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import {
  createDraftEntry,
  parseJournalEntryBody,
  postEntry,
  voidEntry,
} from '../lib/accountingJournal.js';
import { requirePermission } from '../middleware/auth.js';
import { isUuid } from '../lib/ids.js';
import { isValidIsoDate } from '../lib/periods.js';

const router = Router();
const MAX_LISTED = 200;

const ENTRY_COLUMNS = `
  e.id,
  e.entry_no       AS "entryNo",
  e.entry_date     AS "entryDate",
  e.memo,
  e.status,
  e.source_type    AS "sourceType",
  e.source_id      AS "sourceId",
  e.reverses_entry_id AS "reversesEntryId",
  e.posted_at      AS "postedAt",
  e.voided_at      AS "voidedAt",
  e.created_at     AS "createdAt",
  COALESCE(t.totals, 0)::bigint AS total,
  COALESCE(l.lines, '[]') AS lines
`;

const ENTRY_FROM = `
  FROM acct_journal_entries e
  LEFT JOIN (
    SELECT l.entry_id,
           json_agg(json_build_object(
             'id', l.id,
             'accountId', l.account_id,
             'accountCode', a.code,
             'accountName', a.name,
             'debit', l.debit,
             'credit', l.credit,
             'memo', l.memo
           ) ORDER BY a.code, l.debit DESC) AS lines
    FROM acct_journal_lines l
    JOIN acct_accounts a ON a.id = l.account_id
    GROUP BY l.entry_id
  ) l ON l.entry_id = e.id
  LEFT JOIN (
    SELECT entry_id, SUM(debit) AS totals FROM acct_journal_lines GROUP BY entry_id
  ) t ON t.entry_id = e.id
`;

router.get('/', async (req, res) => {
  const { status, accountId, sourceType, from, to } = req.query;
  const conditions = ['TRUE'];
  const values = [];
  const push = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (status !== undefined) {
    if (!['draft', 'posted', 'voided'].includes(status)) {
      return res.status(400).json({
        error: 'status must be draft, posted or voided.',
        code: 'VALIDATION_INVALID_CHOICE',
      });
    }
    conditions.push(`e.status = ${push(status)}`);
  }
  if (accountId !== undefined) {
    if (!isUuid(accountId)) {
      return res.status(400).json({
        error: 'accountId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
      });
    }
    conditions.push(
      `EXISTS (SELECT 1 FROM acct_journal_lines x
               WHERE x.entry_id = e.id AND x.account_id = ${push(accountId)})`
    );
  }
  if (sourceType !== undefined) {
    conditions.push(`e.source_type = ${push(String(sourceType).slice(0, 40))}`);
  }
  if (from !== undefined) {
    if (!isValidIsoDate(from)) {
      return res.status(400).json({
        error: 'from must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
      });
    }
    conditions.push(`e.entry_date >= ${push(from)}::date`);
  }
  if (to !== undefined) {
    if (!isValidIsoDate(to)) {
      return res.status(400).json({
        error: 'to must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
      });
    }
    conditions.push(`e.entry_date <= ${push(to)}::date`);
  }

  const result = await pool.query(
    `SELECT ${ENTRY_COLUMNS}
     ${ENTRY_FROM}
     WHERE ${conditions.join(' AND ')}
     ORDER BY e.entry_date DESC, e.entry_no DESC
     LIMIT ${MAX_LISTED + 1}`,
    values
  );
  res.json({
    entries: result.rows.slice(0, MAX_LISTED),
    truncated: result.rows.length > MAX_LISTED,
  });
});

router.post('/', async (req, res) => {
  const parsed = parseJournalEntryBody(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await createDraftEntry(client, {
      user: req.user,
      ...parsed.value,
    });
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'accounting_entry.draft',
      entityType: 'acct_journal_entry',
      details: { entryId: created.entryId, entryNo: created.entryNo },
    });
    await client.query('COMMIT');
    const full = await pool.query(
      `SELECT ${ENTRY_COLUMNS} ${ENTRY_FROM} WHERE e.id = $1`,
      [created.entryId]
    );
    res.status(201).json({ entry: full.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(404).json({
      error: 'Entry not found.',
      code: 'NOT_FOUND',
      params: { entity: 'entry' },
    });
  }
  next();
});

async function readEntry(id) {
  const result = await pool.query(
    `SELECT ${ENTRY_COLUMNS} ${ENTRY_FROM} WHERE e.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

router.get('/:id', async (req, res) => {
  const entry = await readEntry(req.params.id);
  if (!entry) {
    return res.status(404).json({
      error: 'Entry not found.',
      code: 'NOT_FOUND',
      params: { entity: 'entry' },
    });
  }
  res.json({ entry });
});

router.post('/:id/post', requirePermission('accounting.post'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await postEntry(client, { user: req.user, entryId: req.params.id });
    if (result.error) {
      await client.query('ROLLBACK');
      const status = result.error === 'NOT_FOUND' ? 404 : 409;
      const message =
        result.error === 'NOT_FOUND'
          ? 'Entry not found.'
          : 'Only drafts can be posted.';
      return res.status(status).json({ error: message, code: result.error });
    }
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'accounting_entry.post',
      entityType: 'acct_journal_entry',
      details: { entryId: req.params.id, entryNo: result.entryNo },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // The 025 triggers speak with their own error text (closed period,
    // imbalance) — surface it as the message with a stable code.
    if (/closed fiscal period/.test(String(err?.message))) {
      return res.status(409).json({
        error: 'The entry falls in a closed fiscal period.',
        code: 'ACCOUNTING_PERIOD_CLOSED',
      });
    }
    throw err;
  } finally {
    client.release();
  }
  const entry = await readEntry(req.params.id);
  res.json({ entry });
});

router.post('/:id/void', requirePermission('accounting.post'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await voidEntry(client, { user: req.user, entryId: req.params.id });
    if (result.error) {
      await client.query('ROLLBACK');
      const status = result.error === 'NOT_FOUND' ? 404 : 409;
      const messages = {
        NOT_FOUND: 'Entry not found.',
        ACCOUNTING_ENTRY_NOT_POSTED: 'Only posted entries can be voided.',
        ACCOUNTING_SYSTEM_ENTRY_IMMUTABLE:
          'Opening and closing entries are controlled by their fiscal workflows.',
      };
      const message = messages[result.error] ?? 'The entry cannot be voided.';
      return res.status(status).json({ error: message, code: result.error });
    }
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'accounting_entry.void',
      entityType: 'acct_journal_entry',
      details: { entryId: req.params.id, entryNo: result.entryNo },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const entry = await readEntry(req.params.id);
  res.json({ entry });
});

export default router;
