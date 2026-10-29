import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, login } from './isolated.mjs';

const call = api();
let studentId;
let productId;
let saleId;
async function ok(path, options, status = 200) {
  const result = await call(path, options);
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}
try {
  await login(call);
  const name = `Audit free ${randomUUID()}`;
  studentId = (await ok('/api/students', { method: 'POST', body: { fullName: name } }, 201)).id;
  productId = (await ok('/api/cafe/products', { method: 'POST', body: { name, price: 0 } }, 201)).product.id;
  await ok('/api/cafe/inventory', { method: 'POST', body: { kind: 'adjustment', items: [{ productId, qty: 1 }], note: name } }, 201);
  const result = await call('/api/cafe/sales', { method: 'POST', body: { customer: 'student', studentId, items: [{ productId, qty: 1 }], note: name } });
  saleId = result.data?.sale?.id;
  console.log(JSON.stringify({ saleStatus: result.status, errorCode: result.data?.code ?? null, total: result.data?.sale?.total ?? null }, null, 2));
  assert.equal(result.status, 201, 'a permitted zero-price sale must work for a student');
  assert.equal(Number(result.data.sale.total), 0);
  assert.equal(Number((await ok(`/api/cafe/balances/${studentId}`)).balance), 0);
  await ok(`/api/cafe/sales/${saleId}/void`, { method: 'POST' }, 201);
  saleId = null;
  assert.equal((await ok(`/api/cafe/inventory/${productId}`)).qty, 1, 'void restores stock without a zero-value refund');
} finally {
  if (saleId) await ok(`/api/cafe/sales/${saleId}/void`, { method: 'POST' }, 201);
  if (productId) await ok(`/api/cafe/products/${productId}`, { method: 'DELETE' }, 204);
  if (studentId) await ok(`/api/students/${studentId}`, { method: 'DELETE' }, 204);
  await call('/api/auth/logout', { method: 'POST' });
}
