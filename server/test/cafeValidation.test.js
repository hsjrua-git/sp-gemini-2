import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProductBody,
  parseSupplierBody,
} from '../src/validation/cafe.js';

test('products need a trimmed name and a whole-Toman price', () => {
  assert.deepEqual(
    parseProductBody({ name: '  Hot   Chocolate ', price: 25000 }),
    { value: { name: 'Hot Chocolate', price: 25000 } }
  );
  assert.ok(parseProductBody({ name: 'X', price: 12.5 }).error, 'fractional price');
  assert.ok(parseProductBody({ name: 'X', price: -1 }).error, 'negative price');
  assert.ok(parseProductBody({ name: 'X' }).error, 'missing price');
  assert.ok(
    parseProductBody({ name: 'X', price: 1e13 }).error,
    'price above the sanity cap'
  );
});

test('product partial updates validate only the carried fields', () => {
  assert.deepEqual(
    parseProductBody({ price: 30000 }, { partial: true }),
    { value: { price: 30000 } }
  );
  assert.deepEqual(
    parseProductBody({ isActive: false, sortOrder: 4 }, { partial: true }),
    { value: { isActive: false, sortOrder: 4 } }
  );
  assert.ok(
    parseProductBody({ sortOrder: -1 }, { partial: true }).error,
    'negative sort order'
  );
  assert.ok(
    parseProductBody({}, { partial: true }).error,
    'empty partial update'
  );
});

test('suppliers take an optional phone and note; blanks clear to null', () => {
  assert.deepEqual(
    parseSupplierBody({ name: ' Kalleh Dairy ', phone: ' 021-123 ', note: ' ' }),
    { value: { name: 'Kalleh Dairy', phone: '021-123', note: null } }
  );
  assert.deepEqual(parseSupplierBody({ name: 'X' }), { value: { name: 'X' } });
  assert.ok(parseSupplierBody({ name: 'X', phone: 'x'.repeat(31) }).error, 'long phone');
  assert.ok(parseSupplierBody({ name: 'X', note: 'x'.repeat(501) }).error, 'long note');
  assert.deepEqual(
    parseSupplierBody({ isActive: false }, { partial: true }),
    { value: { isActive: false } }
  );
});
