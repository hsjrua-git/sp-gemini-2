import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '../i18n/index.js';
import { buildCube } from './cube.js';
import {
  cubeLongRows,
  cubeWideRows,
  deltaRows,
  auditTrailRows,
  cubeJson,
} from './exports.js';

// The audit trail's category and action text renders through i18next, whose
// default language is Persian; pin English for these assertions (the fa
// renderings are covered by src/i18n tests), like format.test.js does.
beforeAll(() => {
  i18n.changeLanguage('en');
});

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
  cell('s1', 'speed', 2, '2024-02-10', 6),
  cell('s1', 'balance', 2, '2024-02-10', 5),
  cell('s2', 'speed', 2, '2024-02-17', 3),
];
const cube = buildCube({ periods, parameters, assignments, students, cells });

describe('cubeLongRows', () => {
  it('emits one row per observed value in period → student → parameter order', () => {
    const rows = cubeLongRows(cube);
    expect(rows[0]).toEqual([
      'Period', 'Start date', 'End date', 'Student code', 'Full name', 'Parameter',
      'Value (quality)',
    ]);
    // Ana's period-1 speed is the only period-1 value.
    expect(rows[1]).toEqual([
      'Algebra · 1', '2024-01-06', '2024-01-27', 'AAAAAAAA', 'Ana', 'Speed', 4,
    ]);
    // Period 2 walks students before parameters.
    expect(rows[2].slice(4)).toEqual(['Ana', 'Speed', 6]);
    expect(rows[3].slice(4)).toEqual(['Ana', 'Balance', 5]);
    expect(rows[4].slice(4)).toEqual(['Ben', 'Speed', 3]);
    expect(rows).toHaveLength(5);
  });

  it('adds a change column when includeDelta is set', () => {
    const rows = cubeLongRows(cube, { includeDelta: true });
    expect(rows[0]).toContain('Change vs previous period');
    // Ana period-2 speed: 6 − 4 = 2; Ben period-2 speed has no previous.
    expect(rows[2][rows[0].length - 1]).toBe(2);
    expect(rows[4][rows[0].length - 1]).toBe(null);
  });
});

describe('cubeWideRows', () => {
  it('lays out a parameter matrix, one row per period × student with data', () => {
    const rows = cubeWideRows(cube);
    expect(rows[0]).toEqual([
      'Period', 'Start date', 'End date', 'Student code', 'Full name', 'Speed', 'Balance',
    ]);
    // Ana period 1 has only Speed; period 2 both; Ben period 2 Speed only.
    expect(rows[1]).toEqual(['Algebra · 1', '2024-01-06', '2024-01-27', 'AAAAAAAA', 'Ana', 4, null]);
    expect(rows[2]).toEqual(['Algebra · 2', '2024-02-03', '2024-02-24', 'AAAAAAAA', 'Ana', 6, 5]);
    expect(rows[3].slice(4)).toEqual(['Ben', 3, null]);
    expect(rows).toHaveLength(4);
  });
});

describe('deltaRows', () => {
  it('drops rows with no delta and keeps a zero delta', () => {
    const cube2 = buildCube({
      periods,
      parameters,
      assignments,
      students,
      cells: [
        cell('s1', 'speed', 1, '2024-01-06', 4),
        cell('s1', 'speed', 2, '2024-02-10', 4), // zero delta
        cell('s2', 'speed', 2, '2024-02-17', 3), // no previous
      ],
    });
    const rows = deltaRows(cube2);
    expect(rows).toHaveLength(2); // header + Ana's zero-delta row
    expect(rows[1].slice(4)).toEqual(['Ana', 0, null]); // Balance column: no delta
  });
});

describe('auditTrailRows', () => {
  it('maps a category label and reuses describeAudit for the description', () => {
    const rows = auditTrailRows([
      {
        occurredAt: '2025-03-01T10:00:00.000Z',
        actor: 'admin',
        action: 'scores.save',
        details: { count: 3, sessionCode: 'S7', assignmentCode: 'A1' },
      },
    ]);
    expect(rows[0]).toEqual(['When (UTC)', 'User', 'Category', 'Action', 'Description']);
    expect(rows[1]).toEqual([
      '2025-03-01T10:00:00.000Z',
      'admin',
      'Scores',
      'scores.save',
      'Saved 3 cells in session S7',
    ]);
  });
});

describe('cubeJson', () => {
  it('nests values per student per period and drops empty periods', () => {
    const out = cubeJson(cube, { scope: { assignmentId: A1 } });
    expect(out.periods).toHaveLength(2);
    const ana = out.students.find((student) => student.id === 's1');
    // Period 1 carries only Speed; period 2 both, with the delta.
    expect(ana.periods[0]).toEqual({
      period: 'Algebra · 1',
      values: { speed: { value: 4, previous: null, delta: null } },
    });
    expect(ana.periods[1].values.speed).toEqual({ value: 6, previous: 4, delta: 2 });
    expect(ana.periods[1].values.balance.value).toBe(5);
  });
});
