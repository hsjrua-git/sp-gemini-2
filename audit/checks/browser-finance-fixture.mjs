import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { api, login } from './isolated.mjs';

const mode = process.argv[2];
assert.ok(['prepare', 'stock', 'readback', 'cleanup'].includes(mode));
const file = new URL('../runtime/browser-finance-fixture.json', import.meta.url);
const call = api();
let fixture;
const persist = () => fs.writeFile(file, JSON.stringify(fixture, null, 2));
async function request(path, method = 'GET', body, status = 200) {
  const result = await call(path, { method, body });
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}
try {
  await login(call);
  if (mode === 'prepare') {
    const old = await fs.readFile(file, 'utf8').then(JSON.parse).catch(e => { if (e.code !== 'ENOENT') throw e; });
    assert.ok(!old || old.cleaned, 'clean previous finance fixture first');
    fixture = { name: `Audit POS ${randomBytes(5).toString('hex')}`, cleaned: false };
    await persist();
    fixture.studentId = (await request('/api/students', 'POST', { fullName: fixture.name }, 201)).id;
    await persist();
    fixture.productId = (await request('/api/cafe/products', 'POST', { name: fixture.name, price: 100 }, 201)).product.id;
    await persist();
    fixture.supplierId = (await request('/api/cafe/suppliers', 'POST', { name: fixture.name }, 201)).supplier.id;
    await persist();
    console.log(JSON.stringify(fixture));
  } else {
    fixture = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(fixture.cleaned, false);
    const sales = (await request(`/api/cafe/sales?studentId=${fixture.studentId}&includeVoided=1`)).sales;
    const purchases = (await request(`/api/cafe/purchases?supplierId=${fixture.supplierId}`)).purchases;
    if (mode === 'stock') {
      assert.equal(purchases.length, 0, 'stock the fresh fixture only once');
      console.log(JSON.stringify(await request('/api/cafe/purchases', 'POST', {
        supplierId: fixture.supplierId,
        items: [{ productId: fixture.productId, qty: 1, unitCost: 100 }],
        note: 'Audit POS quote retry stock',
      }, 201)));
    } else if (mode === 'readback') {
      const sourceIds = new Set([...sales, ...purchases].map(row => row.id));
      const journals = (await request('/api/accounting/journal')).entries.filter(row => sourceIds.has(row.sourceId));
      console.log(JSON.stringify({ fixture, purchases, sales,
        balance: await request(`/api/cafe/balances/${fixture.studentId}`),
        stock: await request(`/api/cafe/inventory/${fixture.productId}`), journals }, null, 2));
    } else {
      for (const sale of sales) {
        if (!sale.voidedAt) await request(`/api/cafe/sales/${sale.id}/void`, 'POST', undefined, 201);
      }
      const balance = await request(`/api/cafe/balances/${fixture.studentId}`);
      assert.equal(Number(balance.balance), 0, 'sale void must settle synthetic student');
      const stock = await request(`/api/cafe/inventory/${fixture.productId}`);
      assert.equal(stock.qty, purchases.reduce((sum, row) => sum + row.items.reduce((n, item) => n + Number(item.qty), 0), 0));
      await request(`/api/cafe/products/${fixture.productId}`, 'DELETE', undefined, 204);
      await request(`/api/cafe/suppliers/${fixture.supplierId}`, 'DELETE', undefined, 204);
      await request(`/api/students/${fixture.studentId}`, 'DELETE', undefined, 204);
      fixture.cleaned = true;
      await persist();
      console.log(JSON.stringify({ cleanup: 'complete', studentBalance: balance.balance,
        stockRestored: stock.qty, voidedSales: sales.map(row => row.id), retainedPurchases: purchases.map(row => row.id) }));
    }
  }
} finally {
  await call('/api/auth/logout', { method: 'POST' }).catch(() => {});
}
