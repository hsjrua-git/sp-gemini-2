import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyNumber, sumMoney } from '../src/lib/money.js';

test('money conversion preserves exact safe bigint values', () => {
  assert.equal(moneyNumber('9007199254740991'), Number.MAX_SAFE_INTEGER);
  assert.equal(moneyNumber('-42'), -42);
  assert.equal(sumMoney(['100', 20, 3n]), 123);
});

test('money conversion refuses precision loss', () => {
  assert.throws(
    () => moneyNumber('9007199254740992'),
    (err) => err.code === 'MONEY_OUT_OF_RANGE' && err.status === 409
  );
  assert.throws(
    () => sumMoney(['9007199254740991', '1']),
    (err) => err.code === 'MONEY_OUT_OF_RANGE'
  );
});
