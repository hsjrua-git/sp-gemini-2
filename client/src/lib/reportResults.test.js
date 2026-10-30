import { dashboardResults, scopedHistory } from './reportResults.js';
import { summarize } from './dashboard.js';
import { buildCube } from './cube.js';
import { cubeWideRows } from './exports.js';

test('dashboard keeps assignment-period cells distinct and counts a shared student once', () => {
  const parameters = [{ id: 'p', name: 'P' }];
  const grids = [1, 2].map(n => ({ assignment: { id: `a${n}` }, period: { id: `period${n}`, seq: 1 },
    rows: [{ studentId: 's', cells: { p: { quality: 80 } }, previous: {} }] }));
  const result = dashboardResults({ parameters, grids });
  expect(result.rows).toHaveLength(1);
  expect(result.parameters).toHaveLength(2);
  expect(summarize(result)).toMatchObject({ students: 1, measured: 2, expected: 2 });
});

test('student history uses exact assignment-period membership, including overlapping dates', () => {
  const rows = [
    { assignmentId: 'a', periodSeq: 1, qualityValue: 80 },
    { assignmentId: 'a', periodSeq: 2, qualityValue: 90 },
    { assignmentId: 'b', periodSeq: 1, qualityValue: 70 },
    { assignmentId: 'a', periodSeq: null, qualityValue: null },
  ];
  expect(scopedHistory(rows, [{ assignmentId: 'a', seq: 1 }, { assignmentId: 'b', seq: 1 }])).toEqual([rows[0], rows[2]]);
  expect(scopedHistory(rows, [])).toEqual([]);
});

test('scoped export filters each period independently and preserves explicit previous values', () => {
  const cube = buildCube({ dimension: 'quality', parameters: [{ id: 'p', name: 'P' }],
    students: [{ id: 's', fullName: 'Student' }], assignments: [{ id: 'a', name: 'A' }],
    periods: [2, 3].map(seq => ({ assignmentId: 'a', seq, startDate: `2026-0${seq}-01`, endDate: `2026-0${seq}-10` })),
    periodStudents: { 'a:2': ['s'], 'a:3': ['s'] }, filters: [{ parameterId: 'p', op: 'gte', value: 50 }],
    cells: [{ studentId: 's', parameterId: 'p', assignmentId: 'a', periodSeq: 2, quality: 75, previous: { quality: 40 } },
      { studentId: 's', parameterId: 'p', assignmentId: 'a', periodSeq: 3, quality: 20, previous: null }] });
  expect(cube.students).toHaveLength(1);
  expect(cube.cellAt('s', 'p', 'a:2')).toEqual({ value: 75, previous: 40, delta: 35 });
  expect(cube.valueAt('s', 'p', 'a:3')).toBeNull();
  expect(cubeWideRows(cube)).toHaveLength(2);
});
