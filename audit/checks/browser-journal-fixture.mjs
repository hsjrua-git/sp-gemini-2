import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { api, login, openDatabase } from './isolated.mjs';

const mode = process.argv[2];
assert.ok(['prepare', 'draft', 'posted', 'voided'].includes(mode));
const file = new URL('../runtime/browser-journal-fixture.json', import.meta.url);
const call = api();
const db = openDatabase();
async function request(path) {
  const result = await call(path);
  assert.equal(result.status, 200, path);
  return result.data;
}
async function reports(f) {
  const range = `from=${f.date}&to=${f.date}`;
  return {
    trial: await request(`/api/accounting/reports/trial-balance?${range}`),
    income: await request(`/api/accounting/reports/income-statement?${range}`),
    sheet: await request(`/api/accounting/reports/balance-sheet?asOf=${f.date}`),
    ledger: await request(`/api/accounting/reports/ledger?accountId=${f.debitId}&${range}`),
  };
}
try {
  await login(call);
  const identity = (await db.query('SELECT current_database() AS name, inet_server_port() AS port')).rows[0];
  assert.deepEqual(identity, { name: 'student_panel_audit', port: 55439 });
  if (mode === 'prepare') {
    const old = await fs.readFile(file, 'utf8').then(JSON.parse).catch(e => { if (e.code !== 'ENOENT') throw e; });
    assert.ok(!old || old.cleaned, 'finish earlier journal fixture');
    const accounts = (await db.query('SELECT id, code FROM acct_accounts WHERE is_active AND code IN ($1,$2)', ['1100', '4200'])).rows;
    assert.equal(accounts.length, 2);
    const f = { memo: `Audit journal ${randomBytes(5).toString('hex')}`, amount: 321,
      date: new Date().toISOString().slice(0, 10), cleaned: false,
      debitId: accounts.find(a => a.code === '1100').id, creditId: accounts.find(a => a.code === '4200').id };
    f.baseline = await reports(f);
    await fs.writeFile(file, JSON.stringify(f, null, 2));
    console.log(JSON.stringify({ ...f, baseline: { netProfit: f.baseline.income.netProfit,
      totalIncome: f.baseline.income.totalIncome, totalAssets: f.baseline.sheet.totalAssets,
      ledgerClosing: f.baseline.ledger.closingBalance } }));
  } else {
    const f = JSON.parse(await fs.readFile(file, 'utf8'));
    const entries = (await db.query(`SELECT id, entry_no, entry_date::text, status, posted_at, voided_at
      FROM acct_journal_entries WHERE memo=$1`, [f.memo])).rows;
    assert.equal(entries.length, 1);
    const entry = entries[0];
    assert.equal(entry.status, mode);
    const lines = (await db.query('SELECT id, account_id, debit::text, credit::text FROM acct_journal_lines WHERE entry_id=$1 ORDER BY account_id', [entry.id])).rows;
    assert.equal(lines.length, 2);
    assert.equal(lines.reduce((n, l) => n + BigInt(l.debit), 0n), 321n);
    assert.equal(lines.reduce((n, l) => n + BigInt(l.credit), 0n), 321n);
    assert.equal(lines.find(l => l.account_id === f.debitId).debit, '321');
    assert.equal(lines.find(l => l.account_id === f.creditId).credit, '321');
    if (f.lines) assert.deepEqual(lines, f.lines, 'posting/void preserve original line IDs and amounts');
    else f.lines = lines;
    const current = await reports(f);
    const delta = mode === 'posted' ? f.amount : 0;
    assert.equal(Number(current.income.totalIncome) - Number(f.baseline.income.totalIncome), delta);
    assert.equal(Number(current.income.netProfit) - Number(f.baseline.income.netProfit), delta);
    assert.equal(Number(current.sheet.totalAssets) - Number(f.baseline.sheet.totalAssets), delta);
    assert.equal(Number(current.ledger.closingBalance) - Number(f.baseline.ledger.closingBalance), delta);
    assert.equal(current.sheet.balanced, true);
    assert.equal(current.trial.totalDebit, current.trial.totalCredit);
    if (mode !== 'posted') assert.deepEqual(current, f.baseline, 'draft/void have no posted-report impact');
    if (mode === 'posted') assert.ok(entry.posted_at);
    if (mode === 'voided') { assert.ok(entry.posted_at); assert.ok(entry.voided_at); f.cleaned = true; }
    f.entryId = entry.id;
    await fs.writeFile(file, JSON.stringify(f, null, 2));
    console.log(JSON.stringify({ mode, memo: f.memo, entry, lines, reportDelta: delta,
      trialBalanced: true, sheetBalanced: true, reportsRestored: mode === 'voided', cleaned: f.cleaned }));
  }
} finally {
  await call('/api/auth/logout', { method: 'POST' }).catch(() => {});
  await db.end();
}
