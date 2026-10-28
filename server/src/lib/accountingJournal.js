// The journal engine: drafts, posting, voiding, mapped auto-entries, and the
// opening-entry snapshot. All money is bigint Toman. The database triggers
// (025) are the hard guarantee — Σdebit=Σcredit at COMMIT, posted entries
// immutable, closed periods unpostable — this module shapes clean errors and
// the one-transaction flows on top of them.

import { isUuid } from './ids.js';
import { MAX_SAFE_MONEY, moneyNumber, sumMoney } from './money.js';
import { isValidIsoDate } from './periods.js';

// A line is { accountId, debit } XOR { accountId, credit } — never both.
function normalizeLines(lines, { maxLines = 100 } = {}) {
  if (!Array.isArray(lines) || lines.length < 2) {
    return {
      error: 'An entry needs at least two lines.',
      code: 'VALIDATION_INVALID_LENGTH',
      params: { min: 2 },
    };
  }
  if (maxLines !== Infinity && lines.length > maxLines) {
    return {
      error: `An entry may have at most ${maxLines} lines.`,
      code: 'VALIDATION_TOO_LONG',
      params: { max: maxLines },
    };
  }
  const normalized = [];
  for (const line of lines) {
    if (!isUuid(line?.accountId)) {
      return { error: 'Every line needs an account.', code: 'VALIDATION_REQUIRED' };
    }
    const debit = line?.debit ?? 0;
    const credit = line?.credit ?? 0;
    if (
      !Number.isSafeInteger(debit) ||
      !Number.isSafeInteger(credit) ||
      debit < 0 ||
      credit < 0
    ) {
      return {
        error: 'Debit and credit must be exact whole Toman amounts (0 or more).',
        code: 'VALIDATION_INVALID_RANGE',
      };
    }
    if ((debit > 0) === (credit > 0)) {
      return {
        error: 'Each line carries exactly one side: debit or credit.',
        code: 'VALIDATION_INVALID_CHOICE',
      };
    }
    const memo =
      typeof line?.memo === 'string' && line.memo.trim() !== ''
        ? line.memo.trim()
        : null;
    if (memo !== null && memo.length > 500) {
      return {
        error: 'Line memos must be 500 characters or fewer.',
        code: 'VALIDATION_TOO_LONG',
        params: { max: 500 },
      };
    }
    normalized.push({
      accountId: line.accountId,
      debit,
      credit,
      memo,
    });
  }
  const totalDebitExact = normalized.reduce(
    (sum, line) => sum + BigInt(line.debit),
    0n
  );
  const totalCreditExact = normalized.reduce(
    (sum, line) => sum + BigInt(line.credit),
    0n
  );
  if (totalDebitExact !== totalCreditExact) {
    return {
      error: 'The entry does not balance (Σdebit ≠ Σcredit).',
      code: 'ACCOUNTING_UNBALANCED',
      params: {
        debit: totalDebitExact.toString(),
        credit: totalCreditExact.toString(),
      },
    };
  }
  if (totalDebitExact === 0n) {
    return { error: 'An entry cannot be all zeros.', code: 'VALIDATION_INVALID_RANGE' };
  }
  if (totalDebitExact > BigInt(MAX_SAFE_MONEY)) {
    return {
      error: 'The journal total is too large to represent exactly.',
      code: 'MONEY_OUT_OF_RANGE',
      params: { max: String(MAX_SAFE_MONEY) },
    };
  }
  return { value: normalized, total: Number(totalDebitExact) };
}

export function parseJournalEntryBody(body) {
  if (!isValidIsoDate(body?.entryDate)) {
    return {
      error: 'entryDate must be a date (YYYY-MM-DD).',
      code: 'VALIDATION_INVALID_DATE',
    };
  }
  const memo = body?.memo;
  if (
    memo !== undefined && memo !== null && String(memo).trim() !== '' &&
    (typeof memo !== 'string' || memo.trim().length > 500)
  ) {
    return {
      error: 'Memo must be 500 characters or fewer.',
      code: 'VALIDATION_TOO_LONG',
      params: { max: 500 },
    };
  }
  const lines = normalizeLines(body?.lines);
  if (lines.error) return lines;
  return {
    value: {
      entryDate: body.entryDate,
      memo: memo === undefined || memo === null || String(memo).trim() === ''
        ? null
        : memo.trim(),
      lines: lines.value,
    },
  };
}

async function insertLines(db, entryId, lines) {
  await db.query(
    `INSERT INTO acct_journal_lines (entry_id, account_id, debit, credit, memo)
     SELECT $1, x.account_id, x.debit, x.credit, x.memo
     FROM unnest($2::uuid[], $3::bigint[], $4::bigint[], $5::text[])
       AS x(account_id, debit, credit, memo)`,
    [
      entryId,
      lines.map((line) => line.accountId),
      lines.map((line) => line.debit),
      lines.map((line) => line.credit),
      lines.map((line) => line.memo),
    ]
  );
}

// Create a draft. `user` is the acting request user.
export async function createDraftEntry(db, { user, entryDate, memo, lines }) {
  const entry = await db.query(
    `INSERT INTO acct_journal_entries (entry_date, memo, created_by)
     VALUES ($1, $2, $3) RETURNING id, entry_no`,
    [entryDate, memo ?? null, user.id]
  );
  await insertLines(db, entry.rows[0].id, lines);
  return { entryId: entry.rows[0].id, entryNo: Number(entry.rows[0].entry_no) };
}

// Post a draft (accounting.post). Closed-period and immutability rules are
// enforced by the 025 triggers; the mapping on the way out tells the caller
// which constraint fired.
export async function postEntry(db, { user, entryId }) {
  const result = await db.query(
    `UPDATE acct_journal_entries
     SET status = 'posted', posted_by = $2
     WHERE id = $1 AND status = 'draft'
     RETURNING id, entry_no`,
    [entryId, user.id]
  );
  if (result.rowCount === 0) {
    const existing = await db.query(
      'SELECT status FROM acct_journal_entries WHERE id = $1',
      [entryId]
    );
    if (existing.rowCount === 0) {
      return { error: 'NOT_FOUND' };
    }
    return { error: 'ACCOUNTING_ENTRY_NOT_DRAFT' };
  }
  return { entryNo: Number(result.rows[0].entry_no) };
}

// Void a posted entry (accounting.post). Voiding UNPOSTS its economics —
// reports read posted lines only — which is the accounting twin of the cafe
// void that calls this.
export async function voidEntry(db, { user, entryId }) {
  const existing = await db.query(
    `SELECT status, source_type AS "sourceType"
     FROM acct_journal_entries
     WHERE id = $1
     FOR UPDATE`,
    [entryId]
  );
  if (existing.rowCount === 0) return { error: 'NOT_FOUND' };
  if (existing.rows[0].status !== 'posted') {
    return { error: 'ACCOUNTING_ENTRY_NOT_POSTED' };
  }
  if (['opening', 'closing'].includes(existing.rows[0].sourceType)) {
    return { error: 'ACCOUNTING_SYSTEM_ENTRY_IMMUTABLE' };
  }

  const result = await db.query(
    `UPDATE acct_journal_entries
     SET status = 'voided', voided_by = $2
     WHERE id = $1 AND status = 'posted'
     RETURNING id, entry_no`,
    [entryId, user.id]
  );
  return { voided: true, entryNo: Number(result.rows[0].entry_no) };
}

// The cafe auto-post: ONE journal entry per source event, its lines built
// from the active mappings for the listed events (each contributing a debit/
// credit pair scaled to its amount). When no mapping is active the call is a
// no-op — the cafe keeps working standalone. A duplicate posted entry for
// the same source is refused by the partial unique index (a voided entry
// frees the slot).
export async function postMappedEvent(db, { user, sourceType, sourceId, date, memo, pairs }) {
  const events = pairs.map((pair) => pair.event);
  const mappings = await db.query(
    `SELECT m.event, m.debit_account_id, m.credit_account_id
     FROM acct_mappings m
     WHERE m.event = ANY($1::text[]) AND m.is_active`,
    [events]
  );
  if (mappings.rowCount === 0) return { posted: false };

  const lines = [];
  for (const pair of pairs) {
    const mapping = mappings.rows.find((row) => row.event === pair.event);
    if (!mapping) continue;
    const amount = moneyNumber(pair.amount, 'Mapped journal amount');
    if (amount <= 0) continue;
    lines.push({
      accountId: mapping.debit_account_id,
      debit: amount,
      credit: 0,
      memo: pair.memo ?? null,
    });
    lines.push({
      accountId: mapping.credit_account_id,
      debit: 0,
      credit: amount,
      memo: pair.memo ?? null,
    });
  }
  if (lines.length === 0) return { posted: false };

  const total = sumMoney(lines.map((line) => line.debit), 'Mapped journal total');
  // Draft first, lines second, then the post transition — the lines trigger
  // only trusts drafts, and the lifecycle trigger stamps the post.
  const entry = await db.query(
    `INSERT INTO acct_journal_entries
       (entry_date, memo, status, source_type, source_id, created_by)
     VALUES (COALESCE($1::date, current_date), $2, 'draft', $3, $4, $5)
     RETURNING id`,
    [date ?? null, memo ?? null, sourceType, sourceId, user.id]
  );
  await insertLines(db, entry.rows[0].id, lines);
  await db.query(
    `UPDATE acct_journal_entries SET status = 'posted', posted_by = $2
     WHERE id = $1 AND status = 'draft'`,
    [entry.rows[0].id, user.id]
  );
  const numbered = await db.query(
    'SELECT entry_no FROM acct_journal_entries WHERE id = $1',
    [entry.rows[0].id]
  );
  return {
    posted: true,
    entryId: entry.rows[0].id,
    entryNo: Number(numbered.rows[0].entry_no),
    total,
  };
}

// The adopted-accounting snapshot: bring today's cafe inventory value and
// student deposits onto the books. Positive student balances are a liability
// (their money); negative balances are a receivable (they owe the cafe); the
// difference lands in opening equity. Refuses to run twice.
export async function generateOpeningEntry(db, { user, date }) {
  // Serialize the once-ever check across processes/requests. The companion
  // partial unique index in migration 031 is the final DB safety net.
  await db.query(
    `SELECT key FROM acct_invariant_locks
     WHERE key = 'opening_entry'
     FOR UPDATE`
  );
  const existing = await db.query(
    `SELECT id FROM acct_journal_entries
     WHERE source_type = 'opening' AND status = 'posted'`
  );
  if (existing.rowCount > 0) {
    return { error: 'ACCOUNTING_OPENING_EXISTS' };
  }

  const code = (label) =>
    db.query('SELECT id FROM acct_accounts WHERE code = $1', [label]);

  const inventory = await db.query(
    `SELECT COALESCE(SUM(qty * avg_cost), 0)::bigint AS value
     FROM cafe_stock WHERE qty > 0`
  );
  const balances = await db.query(
    `SELECT
       COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0)::bigint AS deposits,
       COALESCE(-SUM(balance) FILTER (WHERE balance < 0), 0)::bigint AS receivable
     FROM student_balances`
  );
  const inventoryValue = moneyNumber(inventory.rows[0].value, 'Opening inventory');
  const deposits = moneyNumber(balances.rows[0].deposits, 'Opening deposits');
  const receivable = moneyNumber(balances.rows[0].receivable, 'Opening receivables');

  // A checked-out pg Client is one wire connection: run these sequentially.
  // Concurrent client.query() calls are deprecated in pg 8 and rejected in 9.
  const inventoryAccount = await code('1200');
  const depositsAccount = await code('2100');
  const receivableAccount = await code('1300');
  const equityAccount = await code('3000');

  const lines = [];
  if (inventoryValue > 0) {
    lines.push({
      accountId: inventoryAccount.rows[0].id,
      debit: inventoryValue,
      credit: 0,
      memo: null,
    });
  }
  if (receivable > 0) {
    lines.push({
      accountId: receivableAccount.rows[0].id,
      debit: receivable,
      credit: 0,
      memo: null,
    });
  }
  if (deposits > 0) {
    lines.push({
      accountId: depositsAccount.rows[0].id,
      debit: 0,
      credit: deposits,
      memo: null,
    });
  }
  if (lines.length === 0) {
    return { error: 'ACCOUNTING_NOTHING_TO_OPEN' };
  }

  const debitTotal = sumMoney(lines.map((line) => line.debit), 'Opening debit total');
  const creditTotal = sumMoney(lines.map((line) => line.credit), 'Opening credit total');
  const plug = debitTotal - creditTotal;
  if (plug > 0) {
    lines.push({
      accountId: equityAccount.rows[0].id,
      debit: 0,
      credit: plug,
      memo: null,
    });
  } else if (plug < 0) {
    lines.push({
      accountId: equityAccount.rows[0].id,
      debit: -plug,
      credit: 0,
      memo: null,
    });
  }

  return createPostedEntry(db, {
    user,
    entryDate: date,
    memo: 'Opening balances',
    sourceType: 'opening',
    sourceId: null,
    lines,
  });
}

// A directly-posted entry with explicit lines (used by the opening snapshot
// and period closing; the balance trigger is the safety net).
export async function createPostedEntry(
  db,
  { user, entryDate, memo, sourceType, sourceId, lines, reversesEntryId, maxLines = 100 }
) {
  const check = normalizeLines(lines, { maxLines });
  if (check.error) return { error: check.code, details: check.error };
  // Draft → lines → post: the lines trigger only trusts drafts.
  const entry = await db.query(
    `INSERT INTO acct_journal_entries
       (entry_date, memo, status, source_type, source_id, created_by, reverses_entry_id)
     VALUES ($1, $2, 'draft', $3, $4, $5, $6)
     RETURNING id`,
    [entryDate, memo ?? null, sourceType ?? null, sourceId ?? null, user.id, reversesEntryId ?? null]
  );
  await insertLines(db, entry.rows[0].id, lines);
  await db.query(
    `UPDATE acct_journal_entries SET status = 'posted', posted_by = $2
     WHERE id = $1 AND status = 'draft'`,
    [entry.rows[0].id, user.id]
  );
  const numbered = await db.query(
    'SELECT entry_no FROM acct_journal_entries WHERE id = $1',
    [entry.rows[0].id]
  );
  return {
    entryId: entry.rows[0].id,
    entryNo: Number(numbered.rows[0].entry_no),
    total: check.total,
  };
}

// The cafe's journal entry for a source event, when one exists.
export async function findEntryBySource(db, sourceType, sourceId) {
  const result = await db.query(
    `SELECT id, status FROM acct_journal_entries
     WHERE source_type = $1 AND source_id = $2 AND status = 'posted'`,
    [sourceType, sourceId]
  );
  return result.rows[0] ?? null;
}

// Close a fiscal period: book the automatic closing entry (income and
// expense balances in the range zeroed into retained earnings, code 3100),
// then lock the range against further posting. Callers hold the period row
// FOR UPDATE.
export async function closeFiscalPeriod(db, { user, periodId }) {
  const period = await db.query(
    `SELECT id, name, start_date AS "startDate", end_date AS "endDate", status
     FROM acct_fiscal_periods WHERE id = $1 FOR UPDATE`,
    [periodId]
  );
  if (period.rowCount === 0) {
    return { error: 'NOT_FOUND' };
  }
  if (period.rows[0].status === 'closed') {
    return { error: 'ACCOUNTING_PERIOD_CLOSED' };
  }
  const { startDate, endDate } = period.rows[0];

  const balances = await db.query(
    `SELECT a.id, a.type,
            CASE a.type
              WHEN 'income'  THEN SUM(l.credit - l.debit)
              WHEN 'expense' THEN SUM(l.debit - l.credit)
            END::bigint AS balance
     FROM acct_journal_lines l
     JOIN acct_journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
     JOIN acct_accounts a ON a.id = l.account_id
     WHERE a.type IN ('income', 'expense')
       AND e.entry_date BETWEEN $1 AND $2
     GROUP BY a.id, a.type
     HAVING CASE a.type
              WHEN 'income'  THEN SUM(l.credit - l.debit)
              WHEN 'expense' THEN SUM(l.debit - l.credit)
            END <> 0`,
    [startDate, endDate]
  );

  let closingLines = 0;
  if (balances.rows.length > 0) {
    const equity = await db.query(
      `SELECT id FROM acct_accounts WHERE code = '3100'`
    );
    const equityId = equity.rows[0].id;
    const lines = [];
    for (const row of balances.rows) {
      const balance = moneyNumber(row.balance, 'Closing account balance');
      if (row.type === 'income') {
        // Normal income is a credit balance. Contra-income is a valid debit
        // balance, so reverse both sides rather than producing negative lines.
        if (balance > 0) {
          lines.push({ accountId: row.id, debit: balance, credit: 0, memo: null });
          lines.push({ accountId: equityId, debit: 0, credit: balance, memo: null });
        } else {
          const amount = Math.abs(balance);
          lines.push({ accountId: row.id, debit: 0, credit: amount, memo: null });
          lines.push({ accountId: equityId, debit: amount, credit: 0, memo: null });
        }
      } else {
        // Normal expense is a debit balance; contra-expense is a credit.
        if (balance > 0) {
          lines.push({ accountId: row.id, debit: 0, credit: balance, memo: null });
          lines.push({ accountId: equityId, debit: balance, credit: 0, memo: null });
        } else {
          const amount = Math.abs(balance);
          lines.push({ accountId: row.id, debit: amount, credit: 0, memo: null });
          lines.push({ accountId: equityId, debit: 0, credit: amount, memo: null });
        }
      }
    }
    closingLines = lines.length;
    const closing = await createPostedEntry(db, {
      user,
      entryDate: endDate,
      memo: `Closing: ${period.rows[0].name}`,
      sourceType: 'closing',
      sourceId: periodId,
      lines,
      maxLines: Infinity,
    });
    if (closing.error) return closing;
  }

  await db.query(
    `UPDATE acct_fiscal_periods
     SET status = 'closed', closed_by = $2, closed_at = now()
     WHERE id = $1`,
    [periodId, user.id]
  );
  return { closed: true, closingLines };
}
