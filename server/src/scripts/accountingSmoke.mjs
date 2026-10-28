// One-off smoke test for the accounting module against the live database,
// entirely inside a transaction that rolls back. Run with:
//   node --env-file=.env src/scripts/accountingSmoke.mjs
//
// Walks the adopt-accounting story with the shipping functions: seed stock,
// book the opening entry, buy/sell through the cafe libs (auto-posting),
// void a sale, verify the balance-sheet identity, exercise the journal
// lifecycle guards (immutability, deferred balancing, closed periods) and
// the period close with its automatic closing entry.

import assert from 'node:assert/strict';
import pool from '../db/pool.js';
import { applyBalanceChange } from '../lib/cafeBalance.js';
import { createSale, voidSale } from '../lib/cafeSale.js';
import {
  closeFiscalPeriod,
  createDraftEntry,
  createPostedEntry,
  generateOpeningEntry,
  parseJournalEntryBody,
  postEntry,
  postMappedEvent,
  voidEntry,
} from '../lib/accountingJournal.js';
import { balanceSheet, incomeStatement, trialBalance } from '../lib/accountingReports.js';

const client = await pool.connect();

// The failing statement must START only after the savepoint exists, hence
// the thunk (a promise created at the call site would enqueue the query
// before the savepoint lands).
async function expectFailure(thunk, pattern, label) {
  await client.query('SAVEPOINT probe');
  try {
    await thunk();
    assert.fail(`${label}: expected a failure`);
  } catch (err) {
    assert.match(String(err.message), pattern, label);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT probe');
  }
}

const accountByCode = async (code) =>
  (await client.query('SELECT id FROM acct_accounts WHERE code = $1', [code]))
    .rows[0].id;

const today = new Date().toISOString().slice(0, 10);

try {
  await client.query('BEGIN');

  const user = (
    await client.query(
      'SELECT id, username FROM users WHERE is_active ORDER BY created_at LIMIT 1'
    )
  ).rows[0];
  const student = (
    await client.query(
      'SELECT id FROM students WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1'
    )
  ).rows[0];
  const supplier = (
    await client.query(`INSERT INTO cafe_suppliers (name) VALUES ('ZZAcct S') RETURNING id`)
  ).rows[0];
  const product = (
    await client.query(
      `INSERT INTO cafe_products (name, price) VALUES ('ZZAcct Cake', 40000) RETURNING id`
    )
  ).rows[0];

  // Pre-accounting stock: a delivery recorded before accounting was adopted.
  const pu = await client.query(
    `INSERT INTO cafe_purchases (supplier_id, created_by) VALUES ($1, $2) RETURNING id`,
    [supplier.id, user.id]
  );
  await client.query(
    `INSERT INTO cafe_purchase_items (purchase_id, product_id, qty, unit_cost)
     VALUES ($1, $2, 12, 25000)`,
    [pu.rows[0].id, product.id]
  );
  await client.query(
    `INSERT INTO cafe_stock_movements (product_id, kind, qty, unit_cost, reference_type, reference_id, created_by)
     VALUES ($1, 'purchase', 12, 25000, 'purchase', $2, $3)`,
    [product.id, pu.rows[0].id, user.id]
  );
  await client.query('UPDATE cafe_products SET avg_cost = 25000 WHERE id = $1', [product.id]);

  // 1. The opening entry brings the pre-existing stock (12 × 25000) onto the
  //    books, plugged by opening equity; running it twice is refused.
  const opening = await generateOpeningEntry(client, { user, date: today });
  assert.equal(opening.total, 300000, 'opening books the stock at cost');
  await expectFailure(
    () => generateOpeningEntry(client, { user, date: today }),
    /ACCOUNTING|opening/i,
    'opening twice refused'
  );

  // 2. A purchase AFTER adoption auto-posts (Dr inventory / Cr cash).
  const purchasePost = await postMappedEvent(client, {
    user,
    sourceType: 'cafe_purchase',
    sourceId: pu.rows[0].id,
    date: today,
    memo: 'Cafe purchase',
    pairs: [{ event: 'cafe.purchase', amount: 300000 }],
  });
  assert.equal(purchasePost.posted, true, 'purchase auto-posts');

  // 3. A student sale auto-posts BOTH pairs (deposits→income + COGS) in one
  //    balanced entry, and charges the balance (overdraft allowed).
  const sale = await createSale(client, {
    user,
    customer: 'student',
    studentId: student.id,
    items: [{ productId: product.id, qty: 3 }],
  });
  assert.equal(sale.total, 120000);
  assert.equal(sale.costTotal, 75000);
  const saleEntry = (
    await client.query(
      `SELECT id, status FROM acct_journal_entries
       WHERE source_type = 'cafe_sale' AND source_id = $1`,
      [sale.saleId]
    )
  ).rows[0];
  assert.ok(saleEntry, 'the sale posted a journal entry');
  const saleLines = await client.query(
    'SELECT debit, credit FROM acct_journal_lines WHERE entry_id = $1',
    [saleEntry.id]
  );
  assert.equal(saleLines.rows.length, 4, 'sale entry carries revenue + COGS pairs');
  assert.equal(
    saleLines.rows.reduce((sum, row) => sum + Number(row.debit), 0),
    120000 + 75000,
    'sale entry debits total'
  );

  // 4. A manual top-up posts its own pair; the student settles the debt.
  await applyBalanceChange(client, {
    studentId: student.id,
    delta: 150000,
    kind: 'topup',
    createdBy: user.id,
  });

  // 5. Reports: trial balance balances; the income statement knows the sale;
  //    the balance sheet identity A = L + E + earnings holds.
  const tb = await trialBalance(client, { from: '1900-01-01', to: today });
  assert.equal(tb.totalDebit, tb.totalCredit, 'trial balance balances');
  const is = await incomeStatement(client, { from: '1900-01-01', to: today });
  assert.equal(is.totalIncome, 120000, 'income statement sees the sale');
  assert.equal(is.totalExpense, 75000, 'COGS is an expense');
  assert.equal(is.netProfit, 45000, 'net profit = revenue − cost');
  const bs = await balanceSheet(client, { asOf: today });
  assert.equal(bs.balanced, true, 'the balance sheet identity holds');

  // 6. Voiding the sale voids its journal entry (unposting its economics).
  await voidSale(client, { user, saleId: sale.saleId });
  const voidedEntry = (
    await client.query('SELECT status FROM acct_journal_entries WHERE id = $1', [
      saleEntry.id,
    ])
  ).rows[0];
  assert.equal(voidedEntry.status, 'voided', 'voiding the sale voids the entry');
  const bsAfter = await balanceSheet(client, { asOf: today });
  assert.equal(bsAfter.balanced, true, 'still balanced after the void');

  // 7. Journal lifecycle guards: posted entries are immutable; lines cannot
  //    touch a posted entry; an unbalanced draft cannot commit (the deferred
  //    trigger fires at COMMIT).
  const draft = await createDraftEntry(client, {
    user,
    entryDate: today,
    memo: 'Rent',
    lines: [
      { accountId: await accountByCode('5200'), debit: 500000, credit: 0, memo: null },
      { accountId: await accountByCode('1100'), debit: 0, credit: 500000, memo: null },
    ],
  });
  const posted = await postEntry(client, { user, entryId: draft.entryId });
  assert.equal(posted.entryNo, draft.entryNo, 'the draft posts');
  await expectFailure(
    () => client.query('UPDATE acct_journal_entries SET memo = $2 WHERE id = $1', [
      draft.entryId,
      'nope',
    ]),
    /immutable/,
    'posted entry memo locked'
  );
  const cashAccount = await accountByCode('1100');
  await expectFailure(
    () => client.query(
      'INSERT INTO acct_journal_lines (entry_id, account_id, debit) VALUES ($1, $2, 1)',
      [draft.entryId, cashAccount]
    ),
    /immutable/,
    'no lines on posted entries'
  );

  const badDraft = await client.query(
    `INSERT INTO acct_journal_entries (entry_date, memo, created_by)
     VALUES ($1, 'unbalanced', $2) RETURNING id`,
    [today, user.id]
  );
  await client.query(
    `INSERT INTO acct_journal_lines (entry_id, account_id, debit) VALUES ($1, $2, 700000)`,
    [badDraft.rows[0].id, cashAccount]
  );
  await client.query('DELETE FROM acct_journal_entries WHERE id = $1', [
    badDraft.rows[0].id,
  ]);

  // The unbalanced-COMMIT test destroys whatever transaction it runs in
  // (the failed COMMIT rolls everything back), so it runs on its own
  // connection against the live schema.
  {
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      const entry = await other.query(
        `INSERT INTO acct_journal_entries (entry_date, memo, created_by)
         VALUES ($1, 'unbalanced', $2) RETURNING id`,
        [today, user.id]
      );
      await other.query(
        `INSERT INTO acct_journal_lines (entry_id, account_id, debit) VALUES ($1, $2, 700000)`,
        [entry.rows[0].id, cashAccount]
      );
      await assert.rejects(
        () => other.query('COMMIT'),
        /does not balance/,
        'unbalanced entry refused at commit'
      );
    } finally {
      await other.query('ROLLBACK').catch(() => {});
      other.release();
    }
  }

  // 8. Closed periods refuse postings; the close books the closing entry
  //    into retained earnings.
  const period = await client.query(
    `INSERT INTO acct_fiscal_periods (name, start_date, end_date)
     VALUES ('ZZ 1405 Q4', current_date - 1, current_date + 1) RETURNING id`
  );
  const closed = await closeFiscalPeriod(client, {
    user,
    periodId: period.rows[0].id,
  });
  assert.equal(closed.closed, true, 'period closes');
  // The sale was voided, so only the rent expense remains to zero: one
  // expense line + its retained-earnings pair.
  assert.equal(closed.closingLines, 2, 'closing entry zeroed the expense');
  // The closing entry is dated the period's end (tomorrow), so the range
  // must reach past it.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const isAfterClose = await incomeStatement(client, {
    from: '1900-01-01',
    to: tomorrow,
  });
  assert.equal(isAfterClose.totalIncome, 0, 'income zeroed by the close');
  assert.equal(isAfterClose.totalExpense, 0, 'expense zeroed by the close');

  const lateDraft = await createDraftEntry(client, {
    user,
    entryDate: today,
    memo: 'too late',
    lines: [
      { accountId: await accountByCode('1300'), debit: 1, credit: 0, memo: null },
      { accountId: await accountByCode('1100'), debit: 0, credit: 1, memo: null },
    ],
  });
  await expectFailure(
    () => postEntry(client, { user, entryId: lateDraft.entryId }),
    /closed fiscal period/,
    'posting into a closed period refused'
  );

  // 9. The parser refuses unbalanced client input before any SQL runs.
  const parsed = parseJournalEntryBody({
    entryDate: today,
    lines: [
      { accountId: (await accountByCode('1100')), debit: 100, credit: 0 },
      { accountId: (await accountByCode('1200')), debit: 0, credit: 90 },
    ],
  });
  assert.equal(parsed.error, 'The entry does not balance (Σdebit ≠ Σcredit).');
  assert.equal(parsed.code, 'ACCOUNTING_UNBALANCED');

  console.log('accounting smoke: all 9 checks passed');
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
