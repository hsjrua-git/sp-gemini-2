import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, login } from './isolated.mjs';

// Real HTTP only. Synthetic field/student are archived/soft-deleted afterwards.
const admin = api();
const viewer = api();
let fieldId;
let studentId;
try {
  await login(admin);
  const user = await login(viewer, 'sample-viewer');
  assert.ok(!user.permissions.includes('fields.view_restricted'));
  const field = await admin('/api/field-definitions', {
    method: 'POST', body: { label: `Audit privacy ${randomUUID()}`, fieldType: 'text', isRestricted: true },
  });
  assert.equal(field.status, 201);
  fieldId = field.data.field.id;
  const student = await admin('/api/students', {
    method: 'POST', body: { fullName: `Audit privacy ${randomUUID()}`, extra: { [fieldId]: 'synthetic-private-marker' } },
  });
  assert.equal(student.status, 201);
  studentId = student.data.id;
  const before = await viewer(`/api/students/${studentId}`);
  assert.equal(before.status, 200);
  assert.equal(Object.hasOwn(before.data.extra, fieldId), false, 'active restricted field is hidden');
  assert.equal((await admin(`/api/field-definitions/${fieldId}`, { method: 'DELETE' })).status, 204);
  const after = await viewer(`/api/students/${studentId}`);
  const list = await viewer(`/api/students?search=${encodeURIComponent(student.data.fullName)}`);
  assert.equal(after.status, 200);
  assert.equal(list.status, 200);
  const item = list.data.students.find(row => row.id === studentId);
  assert.ok(item);
  const observed = {
    activeValueHidden: !Object.hasOwn(before.data.extra, fieldId),
    archivedValueLeakedInDetail: Object.hasOwn(after.data.extra, fieldId),
    archivedValueLeakedInList: Object.hasOwn(item.extra, fieldId),
  };
  console.log(JSON.stringify(observed, null, 2));
  assert.equal(observed.archivedValueLeakedInDetail, false, 'archiving must not expose private field data');
  assert.equal(observed.archivedValueLeakedInList, false);
} finally {
  if (studentId) assert.equal((await admin(`/api/students/${studentId}`, { method: 'DELETE' })).status, 204);
  if (fieldId) assert.equal((await admin(`/api/field-definitions/${fieldId}`, { method: 'DELETE' })).status, 204);
  await admin('/api/auth/logout', { method: 'POST' });
  await viewer('/api/auth/logout', { method: 'POST' });
}
