import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, login } from './isolated.mjs';
import { parsePurchaseBody, parseSaleBody } from '../../server/src/validation/cafe.js';
import { parseInventoryBody } from '../../server/src/validation/cafeInventory.js';

// Each real request uses an active, stocked synthetic product. Collect every
// path before asserting so a failed purchase cannot conceal the sale/waste cases.
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
  const name = `Audit decimals ${randomUUID()}`;
  productId = (await ok('/api/cafe/products', { method: 'POST', body: { name, price: 100 } }, 201)).product.id;
  supplierId = (await ok('/api/cafe/suppliers', { method: 'POST', body: { name } }, 201)).supplier.id;
  await ok('/api/cafe/purchases', { method: 'POST', body: {
    supplierId, items: [{ productId, qty: 10, unitCost: 100 }],
  } }, 201);
  const cases = [
    { path: '/api/cafe/purchases', parser: parsePurchaseBody,
      body: { supplierId, items: [{ productId, qty: 1.005, unitCost: 100 }] } },
    { path: '/api/cafe/sales', parser: parseSaleBody,
      body: { customer: 'walk_in', items: [{ productId, qty: 1.005 }] } },
    { path: '/api/cafe/inventory', parser: parseInventoryBody,
      body: { kind: 'waste', items: [{ productId, qty: 1.005 }] } },
    { path: '/api/cafe/inventory', parser: parseInventoryBody,
      body: { kind: 'adjustment', items: [{ productId, qty: -1.005 }] } },
  ];
  const observations = [];
  for (const item of cases) {
    const parsed = item.parser(item.body);
    const response = await call(item.path, { method: 'POST', body: item.body });
    observations.push({ path: item.path, kind: item.body.kind, quantity: item.body.items[0].qty,
      parserAccepted: !parsed.error, parserError: parsed.error,
      status: response.status, code: response.data?.code, error: response.data?.error });
    if (item.path === '/api/cafe/sales' && response.status === 201) {
      await ok(`/api/cafe/sales/${response.data.sale.id}/void`, { method: 'POST' });
    }
  }
  // Negative controls: genuinely excessive precision must remain invalid.
  const invalid = cases.map(item => item.parser({ ...item.body,
    items: [{ ...item.body.items[0], qty: item.body.kind === 'adjustment' ? -1.0005 : 1.0005 }],
  }).code);
  console.log(JSON.stringify({ binaryProduct: 1.005 * 1000, observations,
    fourDecimalRejectionCodes: invalid }, null, 2));
  assert.ok(invalid.every(code => code === 'VALIDATION_INVALID_FORMAT'));
  assert.ok(observations.every(row => row.parserAccepted && row.status === 201),
    'all four flows must accept quantities with exactly three decimal places');
} finally {
  if (productId) await ok(`/api/cafe/products/${productId}`, { method: 'DELETE' }, 204);
  if (supplierId) await ok(`/api/cafe/suppliers/${supplierId}`, { method: 'DELETE' }, 204);
  await call('/api/auth/logout', { method: 'POST' });
}
