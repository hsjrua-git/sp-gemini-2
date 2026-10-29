import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, login, openDatabase } from './isolated.mjs';

const call = api();
const db = openDatabase();
const students = [];
const failures = [];
let productId, supplierId;
async function ok(path, options, status = 200) {
  const result = await call(path, options);
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}
const balanceRow = async id => (await db.query(
  'SELECT balance, updated_at FROM student_balances WHERE student_id = $1', [id]
)).rows;
try {
  await login(call);
  const name = `Audit zero total ${randomUUID()}`;
  productId = (await ok('/api/cafe/products', { method: 'POST', body: { name, price: 0 } }, 201)).product.id;
  supplierId = (await ok('/api/cafe/suppliers', { method: 'POST', body: { name } }, 201)).supplier.id;
  await ok('/api/cafe/purchases', { method: 'POST', body: {
    supplierId, items: [{ productId, qty: 10, unitCost: 1000 }],
  } }, 201);
  for (const existing of [false, true]) {
    const studentId = (await ok('/api/students', { method: 'POST', body: { fullName: `${name} ${existing}` } }, 201)).id;
    students.push(studentId);
    if (existing) await ok('/api/cafe/balances', { method: 'POST', body: { studentId, kind: 'adjustment', amount: -37 } }, 201);
    for (const [qty, unitPrice, cost] of [[1, 0, 1000], [0.001, 1, 1]]) {
      let saleId;
      try {
        const before = await balanceRow(studentId);
        const history = await ok(`/api/cafe/balances/${studentId}`);
        const sale = await ok('/api/cafe/sales', { method: 'POST', body: {
          customer: 'student', studentId, items: [{ productId, qty, unitPrice }], note: name,
        } }, 201);
        saleId = sale.sale.id;
        assert.equal(Number(sale.sale.total), 0);
        assert.equal(Number(sale.sale.costTotal), cost);
        assert.equal(sale.sale.balanceAfter, existing ? -37 : 0);
        assert.equal(Number((await ok(`/api/cafe/inventory/${productId}`)).qty), 10 - qty);
        const entry = (await ok('/api/accounting/journal?sourceType=cafe_sale')).entries.find(e => e.sourceId === saleId);
        assert.ok(entry, 'COGS is posted even with zero revenue');
        assert.equal(entry.status, 'posted');
        assert.equal(Number(entry.total), cost);
        const voided = await ok(`/api/cafe/sales/${saleId}/void`, { method: 'POST' }, 201);
        assert.equal(voided.balanceAfter, existing ? -37 : 0);
        assert.equal(Number((await ok(`/api/cafe/inventory/${productId}`)).qty), 10);
        assert.equal((await ok('/api/accounting/journal?sourceType=cafe_sale')).entries.find(e => e.id === entry.id).status, 'voided');
        assert.deepEqual(await balanceRow(studentId), before, 'no balance row creation or timestamp change');
        assert.deepEqual(await ok(`/api/cafe/balances/${studentId}`), history, 'no zero charge/refund ledger entries');
        const audits = (await db.query('SELECT action FROM audit_log WHERE details->>\'saleId\' = $1 ORDER BY action', [saleId])).rows;
        assert.deepEqual(audits, [{ action: 'cafe_sale.create' }, { action: 'cafe_sale.void' }]);
        assert.equal((await call(`/api/cafe/sales/${saleId}/void`, { method: 'POST' })).status, 409);
        saleId = null;
        console.log(JSON.stringify({ existing, qty, unitPrice, cost, balance: existing ? -37 : 0, passed: true }));
      } catch (error) {
        failures.push({ existing, qty, error: error.message });
      } finally {
        if (saleId) {
          const result = await call(`/api/cafe/sales/${saleId}/void`, { method: 'POST' });
          assert.ok([201, 409].includes(result.status), 'cleanup void');
        }
      }
    }
  }
  console.log(JSON.stringify({ failures }));
  assert.deepEqual(failures, []);
} finally {
  for (const id of students) {
    const { balance } = await ok(`/api/cafe/balances/${id}`);
    if (balance) await ok('/api/cafe/balances', { method: 'POST', body: { studentId: id, kind: 'adjustment', amount: -balance } }, 201);
    await ok(`/api/students/${id}`, { method: 'DELETE' }, 204);
  }
  if (productId) await ok(`/api/cafe/products/${productId}`, { method: 'DELETE' }, 204);
  if (supplierId) await ok(`/api/cafe/suppliers/${supplierId}`, { method: 'DELETE' }, 204);
  await call('/api/auth/logout', { method: 'POST' });
  await db.end();
}
