import assert from 'node:assert/strict';
import { Panel } from '../../agent/src/panel.js';
import { baseUrl } from './isolated.mjs';

// Real adapter + real server; creates and then voids one audit-only sale.
const panel = new Panel({ baseUrl, username: 'sample-kiosk', password: 'sample-panel-2026' });
let sale;
try {
  await panel.login();
  const products = await panel.listProducts();
  const product = products.find(p => p.name.startsWith('Sample Cafe'));
  assert.ok(product, 'requires sample cafe product');
  sale = await panel.recordSale({ customer: 'walk_in', items: [{ productId: product.id, qty: 1 }], note: 'Audit response contract' });
  console.log(JSON.stringify({ total: sale.total, balanceIsNull: sale.balanceAfter === null, balanceIsNaN: Number.isNaN(sale.balanceAfter) }));
  assert.equal(sale.balanceAfter, null, 'walk-in sale has no student balance');
} finally {
  if (sale) await panel.voidSale(sale.id ?? sale.saleId);
  await panel.logout();
}
