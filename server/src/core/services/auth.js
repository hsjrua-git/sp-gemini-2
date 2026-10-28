// Authentication — static single-user stub (framework-free).
//
// On-device equivalent of routes/auth.js, collapsed for the single-user build.
// There is no login, logout, session, or password: the one person owns the
// device and the data, and is effectively the administrator. So the whole
// argon2 / session.regenerate / rate-limit / change-password surface is
// intentionally DROPPED (the desktop route keeps it; this build has no network
// auth to protect).
//
// What the client still needs from "auth" is the current user for its
// AuthContext, with a permission list its can(key) checks against. Here that is
// the seeded local user (core/bootstrap.js#ensureLocalUser) enriched with the
// full permission catalogue, and can() is always true.

import { getDb } from '../db.js';
import { getLocalUserId } from '../context.js';
import { PERMISSION_KEYS } from '../../lib/permissions.js';

// The user column list. This is a verbatim copy of lib/users.js#USER_COLUMNS,
// inlined ON PURPOSE: lib/users.js imports lib/passwords.js → argon2, which is
// a native Node addon that cannot be bundled into the browser/webview. This
// service runs on-device, so it must not pull that chain in. Keep in sync with
// lib/users.js if the users table shape ever changes (it hasn't since 001).
const USER_COLUMNS = `
  id,
  username,
  full_name            AS "fullName",
  role_id              AS "roleId",
  (SELECT name FROM roles WHERE roles.id = users.role_id) AS "role",
  is_active            AS "isActive",
  must_change_password AS "mustChangePassword",
  last_login_at        AS "lastLoginAt",
  created_at           AS "createdAt"
`;

// The current (only) user — the seeded local admin, holding every permission.
// Shape matches what routes/auth.js#GET /me returned, so the client's
// AuthContext can consume it unchanged. Requires ensureLocalUser() to have run.
export async function getMe() {
  const db = getDb();
  const result = await db.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    [getLocalUserId()],
  );
  const user = result.rows[0];
  // Single admin: hold the entire fixed catalogue, never a stored subset.
  user.permissions = [...PERMISSION_KEYS];
  return { user };
}

// The single user is the admin; every permission check resolves to true.
// (Provided for parity with the client's can(key); the services no longer
// gate on permissions at all.)
export function can() {
  return true;
}
