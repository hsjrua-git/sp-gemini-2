import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidIsoDate, todayIso } from '../src/lib/periods.js';

test('recognises valid calendar dates only', () => {
  assert.equal(isValidIsoDate('2026-03-10'), true);
  assert.equal(isValidIsoDate('2028-02-29'), true);
  assert.equal(isValidIsoDate('2026-02-31'), false);
  assert.equal(isValidIsoDate('2027-02-29'), false);
  assert.equal(isValidIsoDate('2026-3-10'), false);
  assert.equal(isValidIsoDate('20260310'), false);
  assert.equal(isValidIsoDate(20260310), false);
});

test("today's date uses the computer's local calendar day", () => {
  assert.equal(todayIso(new Date(2026, 8, 20, 23, 59)), '2026-09-20');
  assert.equal(todayIso(new Date(2026, 8, 20, 0, 1)), '2026-09-20');
});
