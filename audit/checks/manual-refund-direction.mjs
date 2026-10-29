import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, login, openDatabase } from './isolated.mjs';

// Real API mutations, pinned isolated database. Keep the ledger evidence;
// cleanup voids the synthetic journals, settles and archives only this student.
const call = api();
const db = openDatabase();
let studentId;
async function ok(path, options, status = 200) {
  const result = await call(path, options);
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}
try {
  await login(call);
  const mappings = (await db.query(
    `SELECT m.event, m.is_active, d.code AS debit, c.code AS credit
     FROM acct_mappings m JOIN acct_accounts d ON d.id = m.debit_account_id
     JOIN acct_accounts c ON c.id = m.credit_account_id
     WHERE m.event = ANY($1::text[]) ORDER BY m.event`,
    [['balance.refund', 'balance.topup']],
  )).rows;
  assert.deepEqual(mappings, [
    { event: 'balance.refund', is_active: true, debit: '2100', credit: '1100' },
    { event: 'balance.topup', is_active: true, debit: '1100', credit: '2100' },
  ], 'requires the standard active mapping fixture');
  studentId = (await ok('/api/students', {
    method: 'POST', body: { fullName: `Audit refund ${randomUUID()}` },
  }, 201)).id;
  const topup = await ok('/api/cafe/balances', {
    method: 'POST', body: { studentId, kind: 'topup', amount: 1000 },
  }, 201);
  assert.equal(topup.balanceAfter, 1000);
  const refund = await ok('/api/cafe/balances', {
    method: 'POST', body: { studentId, kind: 'refund', amount: 400 },
  }, 201);
  const history = await ok(`/api/cafe/balances/${studentId}`);
  const lines = (await db.query(
    `SELECT t.kind, t.amount::text, t.balance_after::text,
            e.id AS entry_id, e.status, a.code, l.debit::text, l.credit::text
     FROM student_balance_transactions t
     JOIN acct_journal_entries e ON e.source_type = 'balance_txn' AND e.source_id = t.id
     JOIN acct_journal_lines l ON l.entry_id = e.id
     JOIN acct_accounts a ON a.id = l.account_id
     WHERE t.student_id = $1 ORDER BY t.created_at, a.code`, [studentId],
  )).rows;
  assert.equal(lines.length, 4, 'two posted journal pairs must be correlated to these transactions');
  assert.ok(lines.every(row => row.status === 'posted'));
  const deposits = lines.filter(row => row.code === '2100')
    .reduce((sum, row) => sum + Number(row.credit) - Number(row.debit), 0);
  console.log(JSON.stringify({ studentId, mappings, topup, refund,
    expectedBalance: 600, actualBalance: history.balance, depositLiability: deposits,
    ledger: history.transactions.map(({ kind, amount, balanceAfter }) => ({ kind, amount, balanceAfter })),
    journalLines: lines }, null, 2));
  assert.equal(history.balance, deposits, 'student balance must reconcile with its deposit journal');
  assert.equal(refund.balanceAfter, 600, 'manual cash refund must reduce the prepaid balance');
} finally {
  if (studentId) {
    const entries = (await db.query(
      `SELECT e.id FROM acct_journal_entries e
       JOIN student_balance_transactions t ON e.source_type = 'balance_txn' AND e.source_id = t.id
       WHERE t.student_id = $1 AND e.status = 'posted'`, [studentId],
    )).rows;
    for (const entry of entries) await ok(`/api/accounting/journal/${entry.id}/void`, { method: 'POST' });
    const { balance } = await ok(`/api/cafe/balances/${studentId}`);
    if (balance !== 0) await ok('/api/cafe/balances', {
      method: 'POST', body: { studentId, kind: 'adjustment', amount: -balance, note: 'Audit fixture cleanup' },
    }, 201);
    await ok(`/api/students/${studentId}`, { method: 'DELETE' }, 204);
    console.log(JSON.stringify({ cleanup: 'journals voided, balance settled, student archived' }));
  }
  await call('/api/auth/logout', { method: 'POST' });
  await db.end();
}
