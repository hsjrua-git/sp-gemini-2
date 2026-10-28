// Tests for the Export Center cube (schema-4): the route hands over the
// roster, parameters, assignments, period buckets and student-shaped cells
// (group rows already expanded per member), and buildCube decides which
// columns and cells survive — "all" keeps archived parameters and anything
// scored in the slice, an explicit selection pins the columns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_EXPORT_STUDENTS, buildCube } from '../src/lib/exportCube.js';

const speed = { id: 'speed', code: 'speed', name: 'Speed', minValue: 0, maxValue: 10, archivedAt: null };
const balance = { id: 'balance', code: 'balance', name: 'Balance', minValue: 1, maxValue: 5, archivedAt: null };
const retired = { id: 'retired', code: 'retired', name: 'Retired', minValue: null, maxValue: null, archivedAt: '2026-01-01T00:00:00.000Z' };
const retiredEmpty = { id: 'retiredEmpty', code: 'retired-empty', name: 'Retired Empty', minValue: null, maxValue: null, archivedAt: '2026-01-01T00:00:00.000Z' };
const extra = { id: 'extra', code: 'extra', name: 'Extra', minValue: null, maxValue: null, archivedAt: null };
const ghost = { id: 'ghost', code: 'ghost', name: 'Ghost', minValue: null, maxValue: null, archivedAt: '2026-01-01T00:00:00.000Z' };
const parameters = [speed, balance, retired, retiredEmpty, extra, ghost];

// Cleo has no cells at all; "gone" was deleted and must not surface.
const students = [
  { id: 's1', fullName: 'Ana', studentCode: 'AAAAAAAA' },
  { id: 's2', fullName: 'Ben', studentCode: 'BBBBBBBB' },
  { id: 's3', fullName: 'Cleo', studentCode: 'CCCCCCCC' },
];

const assignments = [{ id: 'a1', code: 'RUN-7', name: 'Running 7' }];

const periods = [
  { assignmentId: 'a1', seq: 2, startDate: '2026-03-02', endDate: '2026-03-09' },
  { assignmentId: 'a1', seq: 3, startDate: '2026-03-10', endDate: '2026-03-16' },
];

const cell = (over = {}) => ({
  parameterId: 'speed',
  studentId: 's1',
  assignmentId: 'a1',
  periodSeq: 2,
  sessionDate: '2026-03-05',
  quality: null,
  quantity: null,
  viaGroup: false,
  ...over,
});

const cells = [
  cell({ quality: 6 }),
  cell({ quality: 8, periodSeq: 3, sessionDate: '2026-03-12' }),
  cell({ parameterId: 'balance', quality: 5, periodSeq: 3, sessionDate: '2026-03-12' }),
  // The retired parameter still carries a score inside the slice.
  cell({ parameterId: 'retired', studentId: 's2', quality: 2 }),
  // Scores belonging to a since-deleted student are not part of the cube.
  cell({ studentId: 'gone', parameterId: 'ghost', quality: 9, periodSeq: 3, sessionDate: '2026-03-12' }),
  cell({ studentId: 'gone', quantity: 9, periodSeq: 3, sessionDate: '2026-03-12' }),
];

function build(overrides = {}) {
  return buildCube({
    parameters,
    students,
    assignments,
    periods,
    cells,
    selectedParameterIds: null,
    ...overrides,
  });
}

test('"all" columns keep active parameters and anything scored; unscored archived drop', () => {
  const cube = build();
  // speed, balance, and extra are active so they stay visible; retired is
  // archived but scored in the slice so it stays too. retiredEmpty (archived,
  // unscored) and ghost (archived, scored only by a deleted student) drop.
  assert.deepEqual(
    cube.parameters.map((p) => [p.code, p.minValue, p.maxValue]),
    [
      ['speed', 0, 10],
      ['balance', 1, 5],
      ['retired', null, null],
      ['extra', null, null],
    ]
  );
});

test('cells of deleted students and dropped columns are filtered out; the rest pass through', () => {
  const cube = build();
  const keys = cube.cells
    .map((c) => `${c.studentId}:${c.parameterId}:p${c.periodSeq}=${c.quality}`)
    .sort();
  assert.deepEqual(keys, [
    's1:balance:p3=5',
    's1:speed:p2=6',
    's1:speed:p3=8',
    's2:retired:p2=2',
  ]);
  // Surviving cells pass through untouched — the full shape the route's SQL
  // projects: both dimensions, the session date and the group-expansion flag.
  assert.deepEqual(
    cube.cells.find((c) => c.studentId === 's2'),
    cell({ parameterId: 'retired', studentId: 's2', quality: 2 })
  );
});

test('an explicit parameter selection pins the columns regardless of relevance', () => {
  const cube = build({ selectedParameterIds: ['extra', 'speed'] });
  // extra has never been scored, yet an explicit selection still shows it;
  // column order follows the parameters list, not the selection order.
  assert.deepEqual(
    cube.parameters.map((p) => p.code),
    ['speed', 'extra']
  );
  // Only the speed cells survive the pinned column set.
  assert.deepEqual(
    cube.cells.map((c) => `${c.studentId}:${c.parameterId}`),
    ['s1:speed', 's1:speed']
  );
});

test('the roster is returned in full and the metadata is passed through', () => {
  const cube = build();
  assert.deepEqual(cube.students, [
    { id: 's1', fullName: 'Ana', studentCode: 'AAAAAAAA' },
    { id: 's2', fullName: 'Ben', studentCode: 'BBBBBBBB' },
    { id: 's3', fullName: 'Cleo', studentCode: 'CCCCCCCC' },
  ]);
  assert.deepEqual(cube.assignments, [{ id: 'a1', code: 'RUN-7', name: 'Running 7' }]);
  // Period buckets are the route's business — buildCube forwards them as-is.
  assert.deepEqual(cube.periods, periods);
  // The route uses the cap as its roster LIMIT — pin the shared contract.
  assert.equal(MAX_EXPORT_STUDENTS, 5000);
});
