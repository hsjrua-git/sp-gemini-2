import { describe, it, expect } from 'vitest';
import { buildCube, cohortAverages, cubeValues, periodKey } from './cube.js';

const A1 = '00000000-0000-4000-8000-000000000001';
const A2 = '00000000-0000-4000-8000-000000000002';

const parameters = [
  { id: 'speed', name: 'Speed', minValue: 0, maxValue: 10 },
  { id: 'balance', name: 'Balance', minValue: null, maxValue: null },
];
const assignments = [
  { id: A1, code: 'A1', name: 'Algebra' },
  { id: A2, code: 'A2', name: 'Biology' },
];
const periods = [
  { assignmentId: A1, seq: 1, startDate: '2024-01-06', endDate: '2024-01-27' },
  { assignmentId: A1, seq: 2, startDate: '2024-02-03', endDate: '2024-02-24' },
  { assignmentId: A2, seq: 1, startDate: '2024-01-13', endDate: '2024-02-03' },
];
const students = [
  { id: 's1', fullName: 'Ana', studentCode: 'AAAAAAAA' },
  { id: 's2', fullName: 'Bo', studentCode: 'BBBBBBBB' },
];

function cell(studentId, parameterId, assignmentId, periodSeq, sessionDate, quality, quantity = null, viaGroup = false) {
  return { studentId, parameterId, assignmentId, periodSeq, sessionDate, quality, quantity, viaGroup };
}

const cells = [
  // Ana × speed: two sessions inside A1's period 1 — the LATEST one wins.
  cell('s1', 'speed', A1, 1, '2024-01-06', 4),
  cell('s1', 'speed', A1, 1, '2024-01-20', 6),
  // A group row and Ana's own row on the same date — her own row wins.
  cell('s1', 'balance', A1, 1, '2024-01-20', 7, null, true),
  cell('s1', 'balance', A1, 1, '2024-01-20', 5),
  // A1 period 2: previous bucket for the delta.
  cell('s1', 'speed', A1, 2, '2024-02-10', 9),
  // Bo has no A1 cells at all; one A2 cell.
  cell('s2', 'speed', A2, 1, '2024-01-27', 3),
];

function makeCube(overrides = {}) {
  return buildCube({
    periods,
    parameters,
    assignments,
    students,
    cells,
    ...overrides,
  });
}

describe('buildCube', () => {
  it('looks up values per dimension; latest session in a bucket wins', () => {
    const cube = makeCube();
    const p1 = periodKey(A1, 1);
    expect(cube.valueAt('s1', 'speed', p1)).toBe(6); // not the 4th's 4
    expect(cube.periods.map((period) => period.key)).toEqual([
      periodKey(A1, 1),
      periodKey(A2, 1),
      periodKey(A1, 2),
    ]); // ordered by start date
    expect(cube.periods[0].label).toBe('Algebra · 1');
  });

  it('the member row shadows the group row at the same session date', () => {
    const cube = makeCube();
    expect(cube.valueAt('s1', 'balance', periodKey(A1, 1))).toBe(5);
  });

  it('uses session sequence to order two sessions held on the same date', () => {
    const later = {
      ...cell('s1', 'speed', A1, 1, '2024-01-20', 8),
      sessionSeq: 2,
    };
    const earlier = {
      ...cell('s1', 'speed', A1, 1, '2024-01-20', 3),
      sessionSeq: 1,
    };
    const cube = makeCube({ cells: [later, earlier] });
    expect(cube.valueAt('s1', 'speed', periodKey(A1, 1))).toBe(8);
  });

  it('switches the value column with the dimension', () => {
    const cube = makeCube({ dimension: 'quantity' });
    expect(cube.valueAt('s1', 'speed', periodKey(A1, 1))).toBe(null);
    expect(cube.dimension).toBe('quantity');
  });

  it('computes the delta against the same assignment previous seq; null when either side is missing', () => {
    const cube = makeCube();
    const p2 = periodKey(A1, 2);
    expect(cube.cellAt('s1', 'speed', p2)).toEqual({ value: 9, previous: 6, delta: 3 });
    // A2 period 1 is A2's first — no previous bucket.
    expect(cube.cellAt('s2', 'speed', periodKey(A2, 1)).delta).toBe(null);
  });

  it('exposes lastPeriod as the latest-ending bucket', () => {
    const cube = makeCube();
    expect(cube.lastPeriod.key).toBe(periodKey(A1, 2)); // ends 2024-02-24
  });

  it('narrows the roster with a numeric filter judged at the last period', () => {
    // At the last period only Ana has a speed value (9); a >= 5 filter keeps her.
    const cube = makeCube({ filters: [{ parameterId: 'speed', op: 'gte', value: 5 }] });
    expect(cube.students.map((student) => student.id)).toEqual(['s1']);
    // Judged at the last period only: Bo's value lives in another
    // assignment's bucket, so he is absent there and a value filter drops him.
    const strict = makeCube({ filters: [{ parameterId: 'speed', op: 'lte', value: 5 }] });
    expect(strict.students.map((student) => student.id)).toEqual([]);
  });

  it('supports present/missing filters against the last period', () => {
    const present = makeCube({ filters: [{ parameterId: 'speed', op: 'present' }] });
    expect(present.students.map((student) => student.id)).toEqual(['s1']);
    const missing = makeCube({ filters: [{ parameterId: 'speed', op: 'missing' }] });
    expect(missing.students.map((student) => student.id)).toEqual(['s2']);
  });
});

describe('cohortAverages / cubeValues', () => {
  it('averages one parameter per period over the filtered students', () => {
    const cube = makeCube();
    const averages = cohortAverages(cube, 'speed');
    expect(averages.map((point) => point.average)).toEqual([6, 3, 9]);
    expect(averages[0].period.key).toBe(periodKey(A1, 1));
    expect(cubeValues(cube, 'speed', periodKey(A1, 1))).toEqual([6]);
    expect(cubeValues(cube, 'balance', periodKey(A1, 1))).toEqual([5]);
  });
});
