// Tests for the pure parts of the schema-4 period model: there is no global
// calendar anymore — each assignment's live sessions, ordered by effective
// date (then seq), are bucketed four at a time into periods 1, 2, 3…
// (syncAssignmentPeriods/listAssignmentPeriods need a database and are
// covered separately.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSIONS_PER_PERIOD,
  assignPeriods,
  isValidIsoDate,
  periodSeqForSession,
  todayIso,
} from '../src/lib/periods.js';

const session = (id, sessionDate, seq = 1, extra = {}) => ({
  id,
  seq,
  sessionDate,
  canceledAt: null,
  archivedAt: null,
  ...extra,
});

test('four live sessions make one period', () => {
  assert.equal(SESSIONS_PER_PERIOD, 4);
  const sessions = [
    session('a', '2026-03-01'),
    session('b', '2026-03-08'),
    session('c', '2026-03-15'),
    session('d', '2026-03-22'),
  ];
  assert.deepEqual(
    assignPeriods(sessions),
    new Map([
      ['a', 1],
      ['b', 1],
      ['c', 1],
      ['d', 1],
    ])
  );
});

test('the fifth live session opens period 2, the ninth period 3', () => {
  const sessions = Array.from({ length: 10 }, (_, i) =>
    session(`s${i}`, `2026-03-${String(i + 1).padStart(2, '0')}`)
  );
  const map = assignPeriods(sessions);
  assert.deepEqual(
    sessions.map((s) => map.get(s.id)),
    [1, 1, 1, 1, 2, 2, 2, 2, 3, 3]
  );
});

test('sessions are ordered by effective date before bucketing, whatever the input order', () => {
  const sessions = [
    session('d4', '2026-04-10'),
    session('d2', '2026-02-10'),
    session('d5', '2026-05-10'),
    session('d1', '2026-01-10'),
    session('d3', '2026-03-10'),
    session('d6', '2026-06-10'),
  ];
  const map = assignPeriods(sessions);
  assert.deepEqual(map.get('d1'), 1); // the first four dates → period 1
  assert.deepEqual(map.get('d4'), 1);
  assert.deepEqual(map.get('d5'), 2);
  assert.deepEqual(map.get('d6'), 2);
});

test('same-day sessions are tie-broken by seq', () => {
  const sessions = [
    session('third', '2026-03-01', 3),
    session('fourth', '2026-03-02', 1),
    session('first', '2026-03-01', 1),
    session('second', '2026-03-01', 2),
    session('fifth', '2026-03-02', 2),
  ];
  const map = assignPeriods(sessions);
  assert.deepEqual(map.get('first'), 1);
  assert.deepEqual(map.get('second'), 1);
  assert.deepEqual(map.get('third'), 1);
  assert.deepEqual(map.get('fourth'), 1); // the fourth live session still fits
  assert.deepEqual(map.get('fifth'), 2); // the fifth opens period 2
});

test('canceled and archived sessions sit outside every period', () => {
  const sessions = [
    session('a', '2026-03-01'),
    session('b', '2026-03-02', 1, { canceledAt: '2026-02-20T10:00:00Z' }),
    session('c', '2026-03-03'),
    session('d', '2026-03-04'),
    session('e', '2026-03-05', 1, { archivedAt: '2026-03-10T00:00:00Z' }),
    session('f', '2026-03-06'),
  ];
  const map = assignPeriods(sessions);
  assert.deepEqual([...map.keys()].sort(), ['a', 'c', 'd', 'f']);
  // The dead sessions free their slots: the four live ones fill period 1.
  assert.deepEqual([...map.values()], [1, 1, 1, 1]);
  assert.equal(periodSeqForSession(sessions, 'b'), null);
  assert.equal(periodSeqForSession(sessions, 'e'), null);
});

test('the bucketing does not mutate the caller’s list', () => {
  const sessions = [session('b', '2026-03-02'), session('a', '2026-03-01')];
  assignPeriods(sessions);
  assert.deepEqual(
    sessions.map((s) => s.id),
    ['b', 'a']
  );
});

test('no live sessions, no periods', () => {
  assert.deepEqual(assignPeriods([]), new Map());
  assert.deepEqual(assignPeriods(null), new Map());
  assert.deepEqual(
    assignPeriods([session('x', '2026-03-01', 1, { canceledAt: '2026-02-01T00:00:00Z' })]),
    new Map()
  );
});

test('periodSeqForSession answers for live sessions, null otherwise', () => {
  const sessions = [
    session('a', '2026-03-01'),
    session('b', '2026-03-02'),
    session('c', '2026-03-03', 1, { archivedAt: '2026-03-04T00:00:00Z' }),
  ];
  assert.equal(periodSeqForSession(sessions, 'a'), 1);
  assert.equal(periodSeqForSession(sessions, 'b'), 1);
  assert.equal(periodSeqForSession(sessions, 'c'), null);
  assert.equal(periodSeqForSession(sessions, 'nope'), null);
});

test('recognises valid calendar dates only', () => {
  assert.equal(isValidIsoDate('2026-03-10'), true);
  assert.equal(isValidIsoDate('2028-02-29'), true); // leap year
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
