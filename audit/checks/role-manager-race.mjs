import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { api, login, openDatabase } from './isolated.mjs';

// Real HTTP route reproduction. Run alone: temporarily moves the seeded admin
// and viewer into two custom manager roles, then restores their original roles.
// A table lock pauses both requests at their audit INSERT, AFTER the guards.
// No schema changes, triggers, application mocks, or source edits are used.
const db = openDatabase();
const call = api();
const roles = [];
const originals = [];
let blocker;
let requests = [];
try {
  const admin = await login(call);
  const users = await db.query(
    `SELECT id, username, role_id FROM users
     WHERE username = ANY($1::text[]) ORDER BY username`,
    [['sample-admin', 'sample-viewer']],
  );
  assert.equal(users.rowCount, 2, 'requires the isolated sample fixture');
  originals.push(...users.rows);
  for (const user of originals) {
    const role = await db.query('INSERT INTO roles (name) VALUES ($1) RETURNING id',
      [`Audit race ${randomUUID()}`]);
    const roleId = role.rows[0].id;
    roles.push(roleId);
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_key)
       VALUES ($1, 'users.manage'), ($1, 'roles.manage')`, [roleId],
    );
    await db.query('UPDATE users SET role_id = $1 WHERE id = $2', [roleId, user.id]);
  }
  const countManagers = async () => (await db.query(
    `SELECT rp.permission_key, count(*)::int AS count
     FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id
     WHERE u.is_active AND rp.permission_key = ANY($1::text[])
     GROUP BY rp.permission_key ORDER BY rp.permission_key`,
    [['users.manage', 'roles.manage']],
  )).rows;
  const before = await countManagers();
  assert.deepEqual(before.map(row => row.count), [2, 2], 'only our two seeded managers');

  // Preflight checks the actor before taking the audit-table barrier.
  assert.equal((await call('/api/auth/me')).data.user.id, admin.id);
  blocker = await db.connect();
  await blocker.query('BEGIN');
  await blocker.query('LOCK TABLE audit_log IN SHARE MODE');
  requests = roles.map(id => call(`/api/roles/${id}`, {
    method: 'PATCH', body: { permissions: [] },
  }));
  // Attach rejection handlers immediately; the final assertions remain below.
  const settled = Promise.allSettled(requests);
  let waiting = 0;
  const deadline = Date.now() + 5000;
  do {
    waiting = (await db.query(
      `SELECT count(*)::int AS count FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock' AND query ILIKE '%INSERT INTO audit_log%'`,
    )).rows[0].count;
    if (waiting >= 2) break;
    await pause(20);
  } while (Date.now() < deadline);
  await blocker.query('COMMIT');
  blocker.release();
  blocker = null;
  const responses = await settled;
  const after = await countManagers();
  console.log(JSON.stringify({
    before, requestsAtAuditBarrier: waiting,
    responses: responses.map(r => r.status === 'fulfilled'
      ? { status: r.value.status, code: r.value.data?.code }
      : { error: r.reason.message }),
    after,
  }, null, 2));
  // A fixed implementation may serialize before the barrier (waiting === 1).
  assert.ok(waiting >= 1, 'at least one guarded mutation must reach the audit barrier');
  assert.ok(responses.every(response => response.status === 'fulfilled'), 'transport must complete');
  assert.deepEqual(responses.map(response => response.value.status).sort(), [200, 409]);
  assert.equal(responses.find(response => response.value.status === 409).value.data.code, 'ROLES_LAST_MANAGER');
  assert.equal(after.length, 2, 'both manager capabilities must retain an active holder');
  assert.deepEqual(after.map(row => row.count), [1, 1]);
} finally {
  if (blocker) {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  await Promise.allSettled(requests);
  for (const user of originals) {
    await db.query('UPDATE users SET role_id = $1 WHERE id = $2', [user.role_id, user.id]);
  }
  if (roles.length) await db.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [roles]);
  await call('/api/auth/logout', { method: 'POST' }).catch(() => {});
  await db.end();
}
