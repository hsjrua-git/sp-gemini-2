import { it, expect } from 'vitest';
import { buildResults } from '../../../server/src/lib/results.js';
import { summarize, unmeasuredStudents, parameterStats } from './dashboard.js';

const parameters = [{ id: 'p', name: 'Parameter' }];
const targets = ['score', 'blank', 'quality-note', 'quantity-note'].map(id => ({
  membershipId: id, studentId: id, fullName: id, addedOn: '2020-01-01', leftOn: null,
}));
const evaluations = targets.map(({ membershipId }) => ({
  membershipId, parameterId: 'p', sessionId: 's', sessionDate: '2026-01-01', periodSeq: 1,
  qualityValue: membershipId === 'score' ? 0 : null, quantityValue: null,
  qualityComment: membershipId === 'quality-note' ? 'quality answer' : null,
  quantityComment: membershipId === 'quantity-note' ? 'quantity answer' : null,
}));

it('the real results builder retains dimension-specific comments for dashboard coverage', () => {
  const results = { parameters, ...buildResults({ seq: 1, assignment: { groupId: 'g' }, targets, parameters, evaluations }) };
  expect(summarize(results).measured).toBe(1);
  for (const [dimension, expected] of [['quality', 2], ['quantity', 1]]) {
    const options = { dimension, basis: 'valueOrComment' };
    expect(summarize(results, options).measured).toBe(expected);
    expect(parameterStats(results, options)[0].answeredCount).toBe(expected);
    expect(unmeasuredStudents(results, options)).toHaveLength(4 - expected);
  }
});

it('missing value/comment properties never count as answers', () => {
  const results = { parameters, rows: [{ studentId: 'blank', cells: { p: {} }, previous: {} }] };
  expect(summarize(results).measured).toBe(0);
  expect(summarize(results, { basis: 'valueOrComment' }).measured).toBe(0);
});

it('comments merge only from eligible effective cells across sessions', () => {
  const rows = buildResults({ seq: 1, assignment: { groupId: 'g' }, targets, parameters, evaluations: [
    ...evaluations,
    { ...evaluations[1], membershipId: null, qualityComment: 'group hidden by every own cell' },
    { ...evaluations[1], sessionId: 's2', quantityComment: 'later answer' },
  ] }).rows;
  const blank = rows.find(row => row.studentId === 'blank').cells.p;
  expect(blank.qualityComment).toBe(null);
  expect(blank.quantityComment).toBe('later answer');
  expect(rows.find(row => row.studentId === 'quality-note').cells.p.qualityComment).toBe('quality answer');
});
