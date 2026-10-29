import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePurchaseBody, parseSaleBody } from '../src/validation/cafe.js';
import { parseInventoryBody } from '../src/validation/cafeInventory.js';

const id = '00000000-0000-4000-8000-000000000001';
const flows = {
  purchase: qty => parsePurchaseBody({ supplierId: id, items: [{ productId: id, qty, unitCost: 1 }] }),
  sale: qty => parseSaleBody({ customer: 'walk_in', items: [{ productId: id, qty }] }),
  waste: qty => parseInventoryBody({ kind: 'waste', items: [{ productId: id, qty }] }),
  adjustment: qty => parseInventoryBody({ kind: 'adjustment', items: [{ productId: id, qty }] }),
};
for (const [name, parse] of Object.entries(flows)) {
  test(`${name} accepts decimal thousandths without rounding finer quantities`, () => {
    for (const qty of [1.005, 0.001, '1.005', '1.005e0', 99999.999, 100000,
      ...Array.from({ length: 2000 }, (_, i) => (i + 1) / 1000)]) {
      assert.equal(parse(qty).value?.items[0].qty, Number(qty), `${name}: ${qty}`);
      if (name === 'adjustment') assert.equal(parse(-Number(qty)).value?.items[0].qty, -Number(qty));
    }
    for (const qty of [0.0001, 1.0005, 1.0050000000000001, 99999.9999]) {
      assert.equal(parse(qty).code, 'VALIDATION_INVALID_FORMAT', `${name}: ${qty}`);
      if (name === 'adjustment') assert.equal(parse(-qty).code, 'VALIDATION_INVALID_FORMAT');
    }
    for (const qty of [0, Infinity, NaN, 100000.001, 'invalid']) assert.ok(parse(qty).error);
    if (name !== 'adjustment') assert.ok(parse(-1.005).error);
  });
}
