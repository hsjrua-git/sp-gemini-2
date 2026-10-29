import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { api, login, openDatabase } from './isolated.mjs';

// Extension of A02 across BOTH route transactions. Run alone: the two sample
// users' original role/active states are restored even after a failed assertion.
const db = openDatabase();
const call = api();
const roles = [];
const originals = [];
let blocker;
let requests = [];
const countManagers = async () => (await db.query(
  `SELECT rp.permission_key, count(*)::int AS count
   FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id
   WHERE u.is_active AND rp.permission_key = ANY($1::text[])
   GROUP BY rp.permission_key ORDER BY rp.permission_key`,
  [['roles.manage', 'users.manage']],
)).rows;
try {
  await login(call);
  originals.push(...(await db.query(
    `SELECT id, username, role_id, is_active FROM users
     WHERE username = ANY($1::text[]) ORDER BY username`,
    [['sample-admin', 'sample-viewer']],
  )).rows);
  assert.equal(originals.length, 2);
  assert.ok(originals.every(row => row.is_active));
  for (const user of originals) {
    const roleId = (await db.query('INSERT INTO roles (name) VALUES ($1) RETURNING id',
      [`Audit mixed ${randomUUID()}`])).rows[0].id;
    roles.push(roleId);
    await db.query(`INSERT INTO role_permissions (role_id, permission_key)
      VALUES ($1, 'users.manage'), ($1, 'roles.manage')`, [roleId]);
    await db.query('UPDATE users SET role_id = $1 WHERE id = $2', [roleId, user.id]);
  }
  const before = await countManagers();
  assert.deepEqual(before.map(row => row.count), [2, 2]);
  blocker = await db.connect();
  await blocker.query('BEGIN');
  await blocker.query('LOCK TABLE audit_log IN SHARE MODE');
  requests = [
    call(`/api/roles/${roles[0]}`, { method: 'PATCH', body: { permissions: [] } }),
    call(`/api/users/${originals[1].id}`, { method: 'PATCH', body: { isActive: false } }),
  ];
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
  console.log(JSON.stringify({ before, requestsAtAuditBarrier: waiting,
    responses: responses.map((response, i) => ({ route: i === 0 ? 'roles' : 'users',
      ...(response.status === 'fulfilled' ? { status: response.value.status, code: response.value.data?.code }
        : { error: response.reason.message }) })), after }, null, 2));
  assert.ok(responses.every(response => response.status === 'fulfilled'), 'transport must complete');
  assert.ok(responses.every(response => [200, 409].includes(response.value.status)), '500 is not a passing guard');
  assert.equal(after.length, 2, 'both manager capabilities must retain an active holder');
  assert.ok(after.every(row => row.count >= 1));
} finally {
  if (blocker) {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  await Promise.allSettled(requests);
  for (const user of originals) await db.query(
    'UPDATE users SET role_id = $1, is_active = $2 WHERE id = $3', [user.role_id, user.is_active, user.id],
  );
  if (roles.length) await db.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [roles]);
  console.log(JSON.stringify({ restoredManagers: await countManagers() }));
  await call('/api/auth/logout', { method: 'POST' }).catch(() => {});
  await db.end();
}
