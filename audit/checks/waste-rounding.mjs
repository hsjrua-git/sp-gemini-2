import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, login } from './isolated.mjs';

// Serial real-HTTP regression. Synthetic append-only history remains isolated.
const call = api();
const products = [];
let supplierId;
const failures = [];
async function ok(path, options, status = 200) {
  const result = await call(path, options);
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}
try {
  await login(call);
  const name = `Audit rounding ${randomUUID()}`;
  supplierId = (await ok('/api/cafe/suppliers', { method: 'POST', body: { name } }, 201)).supplier.id;
  for (let i = 0; i < 2; i++) {
    products.push((await ok('/api/cafe/products', { method: 'POST', body: { name: `${name} ${i}`, price: 200 } }, 201)).product.id);
  }
  await ok('/api/cafe/purchases', { method: 'POST', body: {
    supplierId, items: products.map(productId => ({ productId, qty: 10, unitCost: 100 })),
  } }, 201);
  assert.equal((await ok('/api/accounting/mappings')).mappings.find(m => m.event === 'cafe.waste').isActive, true);
  const remaining = [10000, 10000];
  for (const thousandths of [[145], [144], [146], [5, 5], [4], [1000]]) {
    const prior = new Set((await ok('/api/accounting/journal?sourceType=cafe_waste')).entries.map(e => e.id));
    await ok('/api/cafe/inventory', { method: 'POST', body: {
      kind: 'waste', note: name,
      items: thousandths.map((qty, i) => ({ productId: products[i], qty: qty / 1000 })),
    } }, 201);
    const entries = (await ok('/api/accounting/journal?sourceType=cafe_waste')).entries.filter(e => !prior.has(e.id));
    const expected = Number((thousandths.reduce((sum, qty) => sum + BigInt(qty) * 100n, 0n) + 500n) / 1000n);
    const actual = entries.reduce((sum, e) => sum + Number(e.total), 0);
    try {
      assert.equal(entries.length, expected ? 1 : 0);
      assert.equal(actual, expected);
    } catch (error) { failures.push({ thousandths, message: error.message }); }
    console.log(JSON.stringify({ thousandths, expected, actual, entries: entries.length }));
    for (let i = 0; i < thousandths.length; i++) remaining[i] -= thousandths[i];
  }
  for (let i = 0; i < products.length; i++) {
    const ledger = await ok(`/api/cafe/inventory/${products[i]}`);
    assert.equal(Number(ledger.qty), remaining[i] / 1000);
  }
  assert.deepEqual(failures, []);
} finally {
  for (const id of products) await ok(`/api/cafe/products/${id}`, { method: 'DELETE' }, 204);
  if (supplierId) await ok(`/api/cafe/suppliers/${supplierId}`, { method: 'DELETE' }, 204);
  await call('/api/auth/logout', { method: 'POST' });
}
