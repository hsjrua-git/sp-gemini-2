import { describe, it, expect } from 'vitest';
import { buildCube } from './cube.js';
import { buildHeatmap } from './heatmap.js';

const A1 = '00000000-0000-4000-8000-000000000001';

const parameters = [
  { id: 'speed', name: 'Speed', minValue: 0, maxValue: 10 },
  { id: 'balance', name: 'Balance', minValue: null, maxValue: null },
];
const assignments = [{ id: A1, code: 'A1', name: 'Algebra' }];
const students = [
  { id: 's1', fullName: 'Ana', studentCode: 'AAAAAAAA' },
  { id: 's2', fullName: 'Ben', studentCode: 'BBBBBBBB' },
];
const periods = [
  { assignmentId: A1, seq: 1, startDate: '2024-01-06', endDate: '2024-01-27' },
  { assignmentId: A1, seq: 2, startDate: '2024-02-03', endDate: '2024-02-24' },
];
function cell(studentId, parameterId, periodSeq, sessionDate, quality) {
  return { studentId, parameterId, assignmentId: A1, periodSeq, sessionDate, quality, quantity: null, viaGroup: false };
}
const cells = [
  cell('s1', 'speed', 1, '2024-01-06', 4),
  cell('s1', 'speed', 2, '2024-02-10', 8),
  cell('s1', 'balance', 2, '2024-02-10', 5),
  cell('s2', 'speed', 2, '2024-02-17', 3),
];
const cube = buildCube({ periods, parameters, assignments, students, cells });

describe('buildHeatmap axis "period"', () => {
  it('puts periods across the top for one fixed parameter and shades by range', () => {
    const grid = buildHeatmap(cube, { axis: 'period', parameterId: 'speed' });
    expect(grid.parameterId).toBe('speed');
    expect(grid.columns.map((column) => column.key)).toEqual([
      `${A1}:1`,
      `${A1}:2`,
    ]);
    expect(grid.cells[0]).toEqual([
      { value: 4, percent: 40 },
      { value: 8, percent: 80 },
    ]);
    // Ben has nothing in period 1.
    expect(grid.cells[1]).toEqual([
      { value: null, percent: null },
      { value: 3, percent: 30 },
    ]);
  });

  it('falls back to the first parameter when none is named', () => {
    const grid = buildHeatmap(cube, { axis: 'period' });
    expect(grid.parameterId).toBe('speed');
  });
});

describe('buildHeatmap axis "parameter"', () => {
  it('puts parameters across the top for one fixed period; unbounded ranges have no percent', () => {
    const p2 = `${A1}:2`;
    const grid = buildHeatmap(cube, { axis: 'parameter', periodKey: p2 });
    expect(grid.periodKey).toBe(p2);
    expect(grid.columns.map((column) => column.key)).toEqual(['speed', 'balance']);
    expect(grid.cells[0]).toEqual([
      { value: 8, percent: 80 },
      { value: 5, percent: null }, // balance has no min/max
    ]);
    expect(grid.cells[1]).toEqual([
      { value: 3, percent: 30 },
      { value: null, percent: null },
    ]);
  });

  it('defaults to the last requested period', () => {
    const grid = buildHeatmap(cube, { axis: 'parameter' });
    expect(grid.periodKey).toBe(`${A1}:2`);
  });
});
