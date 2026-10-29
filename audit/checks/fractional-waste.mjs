import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, login } from './isolated.mjs';

// Real API, isolated audit DB only. Append-only purchase/waste evidence stays
// in that database; synthetic product and supplier are deactivated afterwards.
const call = api();
let productId;
let supplierId;
async function ok(path, options, status = 200) {
  const result = await call(path, options);
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}
try {
  await login(call);
  const suffix = randomUUID();
  productId = (await ok('/api/cafe/products', { method: 'POST', body: { name: `Audit waste ${suffix}`, price: 200 } }, 201)).product.id;
  supplierId = (await ok('/api/cafe/suppliers', { method: 'POST', body: { name: `Audit waste ${suffix}` } }, 201)).supplier.id;
  await ok('/api/cafe/purchases', { method: 'POST', body: { supplierId, note: `Audit waste ${suffix}`, items: [{ productId, qty: 1, unitCost: 100 }] } }, 201);
  const prior = new Set((await ok('/api/accounting/journal?sourceType=cafe_waste')).entries.map(row => row.id));
  const mapping = (await ok('/api/accounting/mappings')).mappings.find(row => row.event === 'cafe.waste');
  assert.equal(mapping.isActive, true, 'audit fixture needs the waste mapping active');
  await ok('/api/cafe/inventory', { method: 'POST', body: { kind: 'waste', note: `Audit waste ${suffix}`, items: [{ productId, qty: 0.145 }] } }, 201);
  const ledger = await ok(`/api/cafe/inventory/${productId}`);
  const movement = ledger.movements.find(row => row.kind === 'waste');
  assert.equal(movement.qty, -0.145);
  assert.equal(Number(movement.unitCost), 100);
  const entries = (await ok('/api/accounting/journal?sourceType=cafe_waste')).entries.filter(row => !prior.has(row.id));
  assert.equal(entries.length, 1, 'serial probe must create exactly one waste entry');
  // Exact decimal calculation: 145 thousandths * 100 Toman, rounded to whole
  // Toman like the database's numeric-to-bigint cast (positive half rounds up).
  const expected = Number((145n * 100n + 500n) / 1000n);
  const actual = Number(entries[0].total);
  console.log(JSON.stringify({ quantity: 0.145, unitCost: 100, expected, posted: actual, stockAfter: ledger.qty, entryId: entries[0].id }, null, 2));
  assert.equal(actual, expected, 'posted waste must use exact decimal rounding');
} finally {
  if (productId) await ok(`/api/cafe/products/${productId}`, { method: 'DELETE' }, 204);
  if (supplierId) await ok(`/api/cafe/suppliers/${supplierId}`, { method: 'DELETE' }, 204);
  await call('/api/auth/logout', { method: 'POST' });
}
