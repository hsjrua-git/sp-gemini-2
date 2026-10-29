import assert from 'node:assert/strict';
import { api, login } from './isolated.mjs';

// Recover only the known synthetic first-run fixture after its harness cleanup
// omitted required null dimension fields. Never use this as general cleanup.
const call = api();
async function ok(path, options, status = 200) {
  const result = await call(path, options);
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}
await login(call);
try {
  const student = (await ok('/api/students?search=2RKPVVGZ')).students
    .find(item => item.studentCode === '2RKPVVGZ');
  assert.ok(student && /^Audit CSV preservation [a-f0-9-]+$/.test(student.fullName));
  const assignment = (await ok('/api/assignments')).assignments.find(item => item.name === student.fullName);
  assert.ok(assignment?.groupId);
  const sessions = (await ok(`/api/sessions?assignmentId=${assignment.id}`)).sessions;
  const parameterIds = new Set();
  for (const session of sessions) {
    const rows = (await ok(`/api/evaluations?sessionId=${session.id}`)).evaluations;
    rows.forEach(row => parameterIds.add(row.parameterId));
    if (rows.length) await ok('/api/evaluations/bulk', { method: 'PUT', body: {
      sessionId: session.id, overrideReason: 'Audit failed-fixture cleanup',
      entries: rows.map(row => ({ membershipId: row.membershipId, parameterId: row.parameterId,
        selected: false, qualityValue: null, quantityValue: null })),
    } });
    await ok(`/api/sessions/${session.id}`, { method: 'PATCH', body: { archived: true } });
  }
  await ok(`/api/assignments/${assignment.id}`, { method: 'DELETE' }, 204);
  for (const id of parameterIds) await ok(`/api/parameters/${id}`, { method: 'PATCH', body: { archived: true } });
  await ok(`/api/groups/${assignment.groupId}`, { method: 'DELETE' }, 204);
  await ok(`/api/students/${student.id}`, { method: 'DELETE' }, 204);
  console.log(JSON.stringify({ cleanedStudentId: student.id, assignmentId: assignment.id,
    sessions: sessions.map(s => s.id), parameterIds: [...parameterIds] }));
} finally { await call('/api/auth/logout', { method: 'POST' }); }
