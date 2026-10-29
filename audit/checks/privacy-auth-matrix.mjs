import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { api, login, openDatabase } from './isolated.mjs';

// Real isolated HTTP writes; direct SQL is SELECT-only independent verification.
// Failed privacy assertions are collected so auth controls and cleanup still run.
const db = openDatabase();
const admin = api();
const editor = api();
const second = api();
const prefix = `Audit privacy ${randomBytes(5).toString('hex')}`;
const username = `audit-privacy-${randomBytes(5).toString('hex')}`;
const permissions = ['students.view', 'students.create', 'students.edit', 'audit.view'];
const state = { prefix, username, students: [], fields: [], cleaned: false };
const file = new URL('../runtime/privacy-auth-fixture.json', import.meta.url);
const results = [];
const privateValue = 'synthetic-restricted-value';
const publicValue = 'synthetic-public-value';
const secretMarker = 'synthetic-secret-redaction-control';
const passwords = [];
const saveState = () => fs.writeFile(file, JSON.stringify(state, null, 2));
function check(name, fn) {
  try { fn(); results.push({ name, pass: true }); }
  catch (error) { results.push({ name, pass: false, message: error.message }); }
}
async function request(call, path, status = 200, options) {
  const response = await call(path, options);
  assert.equal(response.status, status, `${options?.method ?? 'GET'} ${path}`);
  return response.data;
}
async function signIn(call, password) {
  return request(call, '/api/auth/login', 200, { method: 'POST', body: { username, password } });
}
async function sessions() {
  return (await db.query("SELECT count(*)::int AS count FROM user_sessions WHERE sess->>'userId'=$1", [state.userId])).rows[0].count;
}
async function waitForAudit(studentId, action) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const rows = (await db.query('SELECT id::text, details FROM audit_log WHERE entity_id=$1 AND action=$2 ORDER BY id', [studentId, action])).rows;
    if (rows.length) return rows;
    await delay(50);
  }
  throw new Error(`Expected asynchronous ${action} audit evidence did not arrive`);
}
async function auditPrivacy(label, studentId, fieldId) {
  const stored = await waitForAudit(studentId, 'student.create');
  const create = stored.find(row => row.details?.request?.extra?.[fieldId] === privateValue);
  assert.ok(create, 'positive control: audit stores restricted value before response filtering');
  const adminAudit = await request(admin, '/api/audit?category=student&actor=sample-admin');
  const readerAudit = await request(editor, '/api/audit?category=student&actor=sample-admin');
  const raw = adminAudit.entries.find(row => row.id === create.id);
  const filtered = readerAudit.entries.find(row => row.id === create.id);
  assert.ok(raw && filtered, 'both responses contain the specific persisted audit entry');
  check(`${label}: admin audit retains restricted marker`, () => assert.ok(JSON.stringify(raw).includes(privateValue)));
  check(`${label}: restricted audit response removes marker and key`, () => {
    assert.equal(JSON.stringify(filtered).includes(privateValue), false);
    assert.equal(JSON.stringify(filtered).includes(fieldId), false);
    assert.ok(JSON.stringify(filtered).includes(publicValue));
  });
  check(`${label}: persisted audit redacts secret-like keys`, () => {
    assert.equal(JSON.stringify(create).includes(secretMarker), false);
    assert.equal(create.details.request.password, '[hidden]');
    assert.equal(create.details.request.metadata.accessToken, '[hidden]');
  });
  console.log(JSON.stringify({ auditPhase: label, persistedEntryId: create.id, responseEntryPresent: true }));
}
const previous = await fs.readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; });
assert.ok(!previous || previous.cleaned, 'settle previous privacy fixture before rerunning');
try {
  const identity = (await db.query('SELECT current_database() AS name, inet_server_port() AS port')).rows[0];
  assert.deepEqual(identity, { name: 'student_panel_audit', port: 55439 });
  await login(admin);
  await saveState();
  const role = await request(admin, '/api/roles', 201, { method: 'POST', body: { name: prefix, permissions } });
  state.roleId = role.role.id;
  await saveState();
  const createdUser = await request(admin, '/api/users', 201, { method: 'POST', body: { username, fullName: prefix, roleId: state.roleId } });
  state.userId = createdUser.user.id;
  await saveState();
  passwords.push(createdUser.temporaryPassword, `Audit-${randomBytes(18).toString('hex')}`);
  const user = (await signIn(editor, passwords[0])).user;
  await signIn(second, passwords[0]);
  assert.equal(user.mustChangePassword, true);
  assert.ok(user.permissions.includes('audit.view'));
  assert.equal(user.permissions.includes('fields.view_restricted'), false);
  assert.equal(await sessions(), 2);
  const gatedRead = await request(editor, '/api/students', 403);
  const gatedWrite = await request(editor, '/api/students', 403, { method: 'POST', body: { fullName: `${prefix} blocked` } });
  check('new-user password gate covers read and mutation', () => {
    assert.equal(gatedRead.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal(gatedWrite.code, 'PASSWORD_CHANGE_REQUIRED');
  });
  const changed = await request(editor, '/api/auth/change-password', 200, { method: 'POST', body: { currentPassword: passwords[0], newPassword: passwords[1] } });
  assert.equal(changed.user.mustChangePassword, false);
  assert.equal(await sessions(), 1);
  await request(second, '/api/auth/me', 401);
  await request(editor, '/api/students', 200);
  check('password change keeps caller session and evicts second session', () => assert.equal(changed.user.mustChangePassword, false));

  for (const restricted of [true, false]) {
    const field = await request(admin, '/api/field-definitions', 201, { method: 'POST', body: { label: `${prefix} ${restricted ? 'private' : 'public'}`, fieldType: 'text', isRestricted: restricted } });
    state.fields.push(field.field.id);
    await saveState();
  }
  const [privateId, publicId] = state.fields;
  const student = await request(admin, '/api/students', 201, { method: 'POST', body: {
    fullName: `${prefix} original`, extra: { [privateId]: privateValue, [publicId]: publicValue },
    password: secretMarker, metadata: { accessToken: secretMarker, harmless: 'visible' },
  } });
  state.students.push(student.id);
  await saveState();
  for (const phase of ['active', 'archived', 'restored']) {
    if (phase === 'archived') await request(admin, `/api/field-definitions/${privateId}`, 204, { method: 'DELETE' });
    if (phase === 'restored') await request(admin, `/api/field-definitions/${privateId}`, 200, { method: 'PATCH', body: { archived: false } });
    const privileged = await request(admin, `/api/students/${student.id}`);
    check(`${phase}: privileged read preserves restricted value`, () => assert.equal(privileged.extra[privateId], privateValue));
    if (phase === 'archived') {
      const deniedPatch = await request(admin, `/api/students/${student.id}`, 400, { method: 'PATCH', body: { extra: { [privateId]: 'archived-write' } } });
      const deniedPost = await request(admin, '/api/students', 400, { method: 'POST', body: { fullName: `${prefix} archived-write`, extra: { [privateId]: privateValue } } });
      check('archived definitions remain unwritable even for privileged users', () => {
        assert.equal(deniedPatch.code, 'NOT_FOUND');
        assert.equal(deniedPost.code, 'NOT_FOUND');
      });
    }
    const detail = await request(editor, `/api/students/${student.id}`);
    const list = await request(editor, `/api/students?search=${encodeURIComponent(prefix)}`);
    const listed = list.students.find(row => row.id === student.id);
    assert.ok(listed, 'list positive control');
    const patch = await request(editor, `/api/students/${student.id}`, 200, { method: 'PATCH', body: { fullName: `${prefix} ${phase}` } });
    for (const [surface, value] of Object.entries({ detail, list: listed, mutation: patch })) {
      check(`${phase}: ${surface} hides restricted field and preserves public field`, () => {
        assert.equal(Object.hasOwn(value.extra, privateId), false, `${surface} contains restricted key`);
        assert.equal(value.extra[publicId], publicValue);
      });
    }
    const denied = await request(editor, `/api/students/${student.id}`, 400, { method: 'PATCH', body: { extra: { [privateId]: 'attempted-overwrite' } } });
    assert.equal(denied.code, 'NOT_FOUND');
    const independent = (await db.query('SELECT extra FROM students WHERE id=$1', [student.id])).rows[0].extra;
    assert.equal(independent[privateId], privateValue);
    assert.equal(independent[publicId], publicValue);
    check(`${phase}: unauthorized field mutation rejected and stored values preserved`, () => assert.equal(independent[privateId], privateValue));
    await auditPrivacy(phase, student.id, privateId);
  }
  const deniedCreate = await request(editor, '/api/students', 400, { method: 'POST', body: { fullName: `${prefix} denied`, extra: { [privateId]: privateValue } } });
  assert.equal(deniedCreate.code, 'NOT_FOUND');
  const ordinary = await request(editor, '/api/students', 201, { method: 'POST', body: { fullName: `${prefix} ordinary`, extra: { [publicId]: publicValue } } });
  state.students.push(ordinary.id);
  await saveState();
  check('nonrestricted creation preserves allowed fields', () => assert.deepEqual(ordinary.extra, { [publicId]: publicValue }));
  await request(admin, `/api/roles/${state.roleId}`, 200, { method: 'PATCH', body: { permissions: ['students.view', 'audit.view'] } });
  await request(editor, `/api/students/${student.id}`, 403, { method: 'PATCH', body: { fullName: `${prefix} forbidden` } });
  check('existing session re-derives reduced role permissions', () => assert.ok(true));
  await request(admin, `/api/roles/${state.roleId}`, 200, { method: 'PATCH', body: { permissions } });

  await signIn(second, passwords[1]);
  assert.equal(await sessions(), 2);
  const reset = await request(admin, `/api/users/${state.userId}/reset-password`, 200, { method: 'POST' });
  passwords.push(reset.temporaryPassword, `Audit-${randomBytes(18).toString('hex')}`);
  assert.equal(await sessions(), 0);
  await request(editor, '/api/auth/me', 401);
  await request(second, '/api/auth/me', 401);
  const resetUser = (await signIn(editor, passwords[2])).user;
  assert.equal(resetUser.mustChangePassword, true);
  await request(editor, '/api/students', 403);
  await request(editor, '/api/auth/change-password', 200, { method: 'POST', body: { currentPassword: passwords[2], newPassword: passwords[3] } });
  check('admin reset evicts all sessions and re-establishes password gate', () => assert.equal(resetUser.mustChangePassword, true));
  await signIn(second, passwords[3]);
  assert.equal(await sessions(), 2);
  await request(admin, `/api/users/${state.userId}`, 200, { method: 'PATCH', body: { isActive: false } });
  assert.equal(await sessions(), 0);
  await request(editor, '/api/auth/me', 401);
  await request(second, '/api/auth/me', 401);
  check('deactivation evicts both sessions', () => assert.equal(state.userId.length, 36));
  const authRows = (await db.query("SELECT action, details FROM audit_log WHERE (actor=$1 AND action LIKE 'auth.%') OR (entity_id=$2 AND action IN ('user.create','user.password_reset'))", [username, state.userId])).rows;
  assert.ok(authRows.some(row => row.action === 'auth.password_change'), 'auth audit positive control');
  const encoded = JSON.stringify(authRows);
  check('actual generated credentials absent from persisted auth audit', () => assert.equal(passwords.some(password => encoded.includes(password)), false));
} finally {
  try {
    if (state.userId) await request(admin, `/api/users/${state.userId}`, 200, { method: 'PATCH', body: { isActive: false } });
    if (state.roleId) await request(admin, `/api/roles/${state.roleId}`, 200, { method: 'PATCH', body: { permissions: [] } });
    for (const id of state.students) await request(admin, `/api/students/${id}`, 204, { method: 'DELETE' });
    for (const id of state.fields) await request(admin, `/api/field-definitions/${id}`, 204, { method: 'DELETE' });
    if (state.userId) {
      assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1', [state.userId])).rows[0].is_active, false);
      assert.equal(await sessions(), 0);
    }
    if (state.roleId) assert.equal((await db.query('SELECT count(*)::int AS n FROM role_permissions WHERE role_id=$1', [state.roleId])).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM students WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL', [state.students])).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM student_field_definitions WHERE id=ANY($1::uuid[]) AND archived_at IS NULL', [state.fields])).rows[0].n, 0);
    state.cleaned = true;
    await saveState();
    console.log(JSON.stringify({ cleanup: state }));
  } finally {
    for (const call of [admin, editor, second]) await call('/api/auth/logout', { method: 'POST' }).catch(() => {});
    await db.end();
  }
}
console.log(JSON.stringify({ checks: results, passed: results.filter(row => row.pass).length, failed: results.filter(row => !row.pass).length }, null, 2));
if (results.some(row => !row.pass)) process.exitCode = 1;
