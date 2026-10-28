import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordAudit } from '../src/lib/audit.js';
import {
  classifyRequest,
  entityIdFromPath,
  normalisePath,
  safeBody,
} from '../src/lib/auditRules.js';

test('paths are normalised before matching', () => {
  assert.equal(normalisePath('/API/Students/?page=2'), '/api/students');
  assert.equal(normalisePath('/api/students'), '/api/students');
});

test('known changes get friendly action names', () => {
  assert.deepEqual(classifyRequest('POST', '/api/students', 201), {
    action: 'student.create',
    entityType: 'student',
  });
  assert.deepEqual(classifyRequest('DELETE', '/api/students/abc', 204), {
    action: 'student.delete',
    entityType: 'student',
  });
  assert.deepEqual(classifyRequest('POST', '/api/assignments', 201), {
    action: 'assignment.create',
    entityType: 'assignment',
  });
  assert.deepEqual(classifyRequest('PATCH', '/api/sessions/abc', 200), {
    action: 'session.update',
    entityType: 'session',
  });
  // Archiving, not deleting, is the schema-4 pattern for catalogues.
  assert.deepEqual(classifyRequest('DELETE', '/api/teachers/abc', 204), {
    action: 'teacher.archive',
    entityType: 'teacher',
  });
  assert.deepEqual(classifyRequest('POST', '/api/auth/logout', 204), {
    action: 'auth.logout',
    entityType: 'user',
  });
  assert.deepEqual(classifyRequest('POST', '/api/auth/change-password', 200), {
    action: 'auth.password_change',
    entityType: 'user',
  });
});

test('sign-in outcomes are recorded, other failures are not', () => {
  assert.equal(classifyRequest('POST', '/api/auth/login', 200).action, 'auth.login');
  assert.equal(
    classifyRequest('POST', '/api/auth/login', 401).action,
    'auth.login_failed'
  );
  assert.equal(classifyRequest('POST', '/api/auth/login', 429), null);
  assert.equal(classifyRequest('POST', '/api/students', 400), null);
  assert.equal(classifyRequest('PATCH', '/api/students/abc', 403), null);
});

test('unknown changes are still recorded; self-logged ones are skipped', () => {
  assert.deepEqual(classifyRequest('POST', '/api/something-new', 200), {
    action: 'api.change',
    entityType: null,
  });
  assert.equal(classifyRequest('PUT', '/api/evaluations/bulk', 200), null);
  assert.equal(classifyRequest('POST', '/api/users', 201), null);
  assert.equal(classifyRequest('PATCH', '/api/users/abc', 200), null);
  assert.equal(classifyRequest('POST', '/api/export/cube', 200), null);
});

test('request bodies are redacted and size-limited', () => {
  assert.deepEqual(
    safeBody({ name: 'Speed', password: 'x', nested: { token: 'y', ok: 1 } }),
    { name: 'Speed', password: '[hidden]', nested: { token: '[hidden]', ok: 1 } }
  );
  assert.deepEqual(safeBody({ text: 'x'.repeat(3000) }), { truncated: true });
  assert.equal(safeBody('a string'), null);
  assert.equal(safeBody(null), null);
});

test('entity ids come from the last path segment when it is a UUID', () => {
  const id = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
  assert.equal(entityIdFromPath(`/api/students/${id}`), id);
  assert.equal(entityIdFromPath('/api/students'), null);
});

// recordAudit's schema-4 snapshot contract: old_data/new_data ride next to
// details; an omitted snapshot lands as SQL NULL, a present one as JSON.
test('recordAudit stores row snapshots; omitted ones become null', async () => {
  const captured = [];
  const db = { query: async (sql, params) => captured.push(params) };

  await recordAudit(db, {
    userId: 'u1',
    actor: 'Admin',
    action: 'student.update',
    entityType: 'student',
    entityId: 's1',
    details: { changes: [{ field: 'fullName' }] },
    oldData: { fullName: 'Old' },
    newData: { fullName: 'New' },
  });
  assert.deepEqual(captured[0], [
    'u1',
    'Admin',
    'student.update',
    'student',
    's1',
    '{"changes":[{"field":"fullName"}]}',
    '{"fullName":"Old"}',
    '{"fullName":"New"}',
  ]);

  // A create carries no old snapshot and a delete carries no new one; the
  // optional fields fall back to null and details to an empty object.
  await recordAudit(db, {
    actor: 'Admin',
    action: 'student.create',
    newData: { fullName: 'New' },
  });
  await recordAudit(db, {
    actor: 'Admin',
    action: 'student.delete',
    oldData: { fullName: 'Old' },
  });
  assert.deepEqual(captured[1], [
    null,
    'Admin',
    'student.create',
    null,
    null,
    '{}',
    null,
    '{"fullName":"New"}',
  ]);
  assert.deepEqual(captured[2].slice(5), ['{}', '{"fullName":"Old"}', null]);
});
