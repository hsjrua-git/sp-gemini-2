import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, login, openDatabase } from './isolated.mjs';
import { summarize, parameterStats } from '../../client/src/lib/dashboard.js';

// Real HTTP writes/reads, then the exact pure helpers used by DashboardPage.
// Run serially. Direct SQL is read-only and pinned to the isolated cluster.
const call = api();
const db = openDatabase();
const students = [];
let groupId, assignmentId, sessionId, parameterId;
const failures = [];
async function ok(path, options, status = 200) {
  const result = await call(path, options);
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}
const cell = (extra = {}) => ({ membershipId: null, parameterId, selected: true,
  qualityValue: null, quantityValue: null, qualityComment: null, quantityComment: null, ...extra });
const save = entries => ok('/api/evaluations/bulk', { method: 'PUT', body: { sessionId, entries } });
const grid = () => ok(`/api/results?assignmentId=${assignmentId}&seq=1&dimension=quality`);
function contract(name, assertion) {
  try { assertion(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(error); console.log(`FAIL ${name}: ${error.message}`); }
}

try {
  await login(call);
  const suffix = randomUUID().slice(0, 12);
  const name = `Audit reports ${suffix}`;
  const imported = await ok('/api/students/import', { method: 'POST', body: {
    rows: ['One', 'Two', 'Three'].map((word, index) => ({ row: index + 1, fullName: `${name} ${word}` })),
  } }, 201);
  students.push(...imported.created);
  assert.equal(students.length, 3);
  groupId = (await ok('/api/groups', { method: 'POST', body: { name } }, 201)).group.id;
  await ok(`/api/groups/${groupId}/members`, { method: 'PUT', body: { add: students.map(s => s.id) } });
  const memberships = (await ok(`/api/groups/${groupId}/members`)).students;
  const member = index => memberships.find(row => row.id === students[index].id).membershipId;
  const timing = (await db.query('SELECT id, current_date::text AS today FROM intervals WHERE archived_at IS NULL ORDER BY every LIMIT 1')).rows[0];
  const teacher = (await db.query('SELECT id FROM teachers WHERE archived_at IS NULL ORDER BY id LIMIT 1')).rows[0];
  assert.ok(timing && teacher);
  assignmentId = (await ok('/api/assignments', { method: 'POST', body: {
    name, groupId, teacherId: teacher.id, intervalId: timing.id, anchorDate: timing.today,
  } }, 201)).assignment.id;
  parameterId = (await ok('/api/parameters', { method: 'POST', body: {
    code: `ar-${suffix}`, name, minValue: 0, maxValue: 10,
  } }, 201)).id;
  await ok('/api/sessions/generate', { method: 'POST', body: { assignmentId, until: timing.today } }, 201);
  const sessions = (await ok(`/api/sessions?assignmentId=${assignmentId}`)).sessions;
  assert.equal(sessions.length, 1);
  sessionId = sessions[0].id;

  await save([cell({ qualityValue: 2 }), cell({ membershipId: member(0), qualityValue: 8 })]);
  const results = await grid();
  const cube = await ok('/api/export/cube', { method: 'POST', body: { assignmentId, parameterIds: [parameterId] } });
  assert.equal(cube.cells.length, 3, 'control: group expands to three students with one override');
  assert.deepEqual(cube.cells.map(c => c.quality).sort((a, b) => a - b), [2, 2, 8]);
  const trends = (await ok(`/api/dashboard/trends?groupId=${groupId}`)).trends;
  const trend = trends.find(t => t.assignmentId === assignmentId && t.parameterId === parameterId);
  assert.ok(trend);
  const resultValues = students.map(s => results.rows.find(r => r.studentId === s.id)?.cells[parameterId]?.quality ?? null);
  console.log(JSON.stringify({ phase: 'whole-group', resultValues,
    cubeValues: cube.cells.map(c => c.quality), trend,
    resultSummary: summarize(results), resultStats: parameterStats(results).find(s => s.parameter.id === parameterId),
  }, null, 2));
  contract('results expand whole-group scores consistently with export', () => assert.deepEqual(resultValues, [8, 2, 2]));
  contract('cohort trend averages effective student cells', () => {
    assert.equal(trend.average, 4, '(8 + 2 + 2) / 3');
    assert.equal(trend.count, 3);
  });

  await save([cell({ selected: false }),
    cell({ membershipId: member(0), qualityValue: 9 }),
    cell({ membershipId: member(1) }),
    cell({ membershipId: member(2), quantityComment: 'quantity-only note' }),
  ]);
  const commentGrid = await grid();
  const values = summarize(commentGrid, { dimension: 'quality', basis: 'value' });
  const comments = summarize(commentGrid, { dimension: 'quality', basis: 'valueOrComment' });
  const sourceCells = (await ok(`/api/evaluations?sessionId=${sessionId}`)).evaluations;
  assert.equal(sourceCells.filter(c => c.qualityValue !== null || c.qualityComment !== null).length, 1);
  console.log(JSON.stringify({ phase: 'dimension-comments', values, comments,
    resultCells: commentGrid.rows.filter(r => !r.isGroup).map(r => r.cells[parameterId]),
    sourceCells: sourceCells.map(c => ({ qualityValue: c.qualityValue, quantityValue: c.quantityValue,
      qualityComment: c.qualityComment, quantityComment: c.quantityComment })),
  }, null, 2));
  contract('blank and quantity-only comment cells do not answer quality', () => {
    assert.equal(values.measured, 1);
    assert.equal(comments.measured, 1);
  });

  await save([cell({ membershipId: member(1), selected: false }), cell({ membershipId: member(2), selected: false })]);
  const sparse = await grid();
  const operational = await ok(`/api/dashboard/summary?assignmentId=${assignmentId}&groupId=${groupId}`);
  console.log(JSON.stringify({ phase: 'denominator-policy-observation', dashboard: summarize(sparse),
    selectedCellSummary: operational.totals,
    note: 'Dashboard tests explicitly use roster x in-use parameters; schema docs use selected cells. Resolve product semantics before changing denominator.'
  }, null, 2));
} finally {
  if (sessionId) {
    const existing = (await ok(`/api/evaluations?sessionId=${sessionId}`)).evaluations;
    if (existing.length) await ok('/api/evaluations/bulk', { method: 'PUT', body: { sessionId,
      entries: existing.map(row => cell({ membershipId: row.membershipId, parameterId: row.parameterId, selected: false })),
      overrideReason: 'Audit fixture cleanup',
    } });
    await ok(`/api/sessions/${sessionId}`, { method: 'PATCH', body: { archived: true } });
  }
  if (assignmentId) await ok(`/api/assignments/${assignmentId}`, { method: 'DELETE' }, 204);
  if (parameterId) await ok(`/api/parameters/${parameterId}`, { method: 'PATCH', body: { archived: true } });
  if (groupId) await ok(`/api/groups/${groupId}`, { method: 'DELETE' }, 204);
  for (const student of students) await ok(`/api/students/${student.id}`, { method: 'DELETE' }, 204);
  await call('/api/auth/logout', { method: 'POST' });
  await db.end();
  console.log('Cleanup: synthetic scores removed, entities archived.');
}
assert.equal(failures.length, 0, `${failures.length} scoring report contracts failed`);
