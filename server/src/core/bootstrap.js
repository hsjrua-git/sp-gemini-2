// Startup bootstrap for the single-user, on-device build.
//
// The app has one user. Rather than special-case "no user" everywhere, we seed
// exactly one local user row (pointed at the seeded Administrator role) and let
// the rest of the schema work unchanged: user_preferences and saved_views hang
// off users(id) with NOT NULL FKs, and the audit trail records a stable actor.
//
// Call ensureLocalUser() once after migrations have run (at app startup, and in
// any test that exercises preferences/saved views). It is idempotent: if the
// local user already exists it just adopts it.

import { getDb } from './db.js';
import { setLocalUser } from './context.js';

const LOCAL_USERNAME = 'local';

export async function ensureLocalUser(db = getDb()) {
  const existing = await db.query(
    `SELECT id, username FROM users WHERE lower(username) = $1`,
    [LOCAL_USERNAME],
  );
  if (existing.rowCount > 0) {
    setLocalUser(existing.rows[0]);
    return existing.rows[0].id;
  }

  const role = await db.query(
    `SELECT id FROM roles WHERE lower(name) = 'administrator'`,
  );
  if (role.rowCount === 0) {
    throw new Error('Administrator role missing — run migrations first.');
  }

  // password_hash is required by the schema but unused on-device (no login);
  // 'x' is a placeholder. must_change_password false so nothing nags the user.
  const inserted = await db.query(
    `INSERT INTO users
       (username, full_name, password_hash, role_id, must_change_password, is_active)
     VALUES ($1, 'Local User', 'x', $2, false, true)
     RETURNING id, username`,
    [LOCAL_USERNAME, role.rows[0].id],
  );
  setLocalUser(inserted.rows[0]);
  return inserted.rows[0].id;
}
