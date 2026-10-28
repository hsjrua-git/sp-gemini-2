import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePgInterval } from '../src/db/pglite.js';

test('PGlite interval parser mirrors the fields scheduling reads from pg', () => {
  assert.deepEqual(parsePgInterval('1 year 2 mons 3 days 04:05:06.5'), {
    years: 1,
    months: 2,
    days: 3,
    hours: 4,
    minutes: 5,
    seconds: 6.5,
  });
  assert.deepEqual(parsePgInterval('7 days'), { days: 7 });
});
