import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { api, login, openDatabase } from './isolated.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../runtime/browser-finance-fixture.json', import.meta.url), 'utf8'));
const call = api();
const db = openDatabase();
async function get(path) {
  const result = await call(path);
  assert.equal(result.status, 200, path);
  return result.data;
}
try {
  await login(call);
  assert.equal(fixture.cleaned, true);
  const sales = (await get(`/api/cafe/sales?studentId=${fixture.studentId}&includeVoided=1`)).sales;
  assert.equal(sales.length, 1);
  assert.ok(sales[0].voidedAt);
  assert.equal(Number(sales[0].total), 15);
  // Archived students deliberately have no balance API response. Inspect only
  // their preserved ledger using the pinned isolated connection (schema saved).
  assert.equal((await call(`/api/cafe/balances/${fixture.studentId}`)).status, 404);
  const balance = (await db.query('SELECT balance FROM student_balances WHERE student_id=$1', [fixture.studentId])).rows[0];
  const transactions = (await db.query('SELECT amount, balance_after, reference_id FROM student_balance_transactions WHERE student_id=$1 ORDER BY created_at, id', [fixture.studentId])).rows;
  assert.equal(Number(balance.balance), 0);
  assert.deepEqual(transactions.map(row => Number(row.amount)), [-15, 15]);
  assert.deepEqual(transactions.map(row => Number(row.balance_after)), [-15, 0]);
  assert.ok(transactions.every(row => row.reference_id === sales[0].id));
  const stock = await get(`/api/cafe/inventory/${fixture.productId}`);
  assert.equal(stock.product.isActive, false);
  assert.equal(stock.qty, 1);
  assert.deepEqual(stock.movements.map(row => [row.referenceType, row.qty]), [
    ['purchase', 1], ['sale', -0.145], ['sale_void', 0.145],
  ]);
  const supplier = (await get('/api/cafe/suppliers?includeInactive=1')).suppliers.find(row => row.id === fixture.supplierId);
  assert.equal(supplier.isActive, false);
  assert.equal((await call(`/api/students/${fixture.studentId}`)).status, 404);
  const journals = (await get('/api/accounting/journal')).entries;
  const saleJournal = journals.find(row => row.sourceId === sales[0].id);
  const purchaseJournal = journals.find(row => row.sourceId === stock.movements[0].referenceId);
  assert.equal(saleJournal.status, 'voided');
  assert.equal(purchaseJournal.status, 'posted');
  for (const entry of [saleJournal, purchaseJournal]) {
    assert.equal(entry.lines.reduce((n, row) => n + row.debit, 0), entry.lines.reduce((n, row) => n + row.credit, 0));
  }
  console.log(JSON.stringify({ fixture: fixture.name, sale: 'voided', charge: 15, balance: 0,
    stock: 1, ledgerReplay: true, journalsBalanced: true, productInactive: true,
    supplierInactive: true, studentArchived: true, purchaseHistory: 'retained' }));
} finally {
  await call('/api/auth/logout', { method: 'POST' }).catch(() => {});
  await db.end();
}
