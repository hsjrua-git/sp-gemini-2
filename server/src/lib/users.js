import pool from '../db/pool.js';
import { hashPassword } from './passwords.js';

// Note: `role` is now the role NAME, resolved from the roles table by a
// correlated subquery so every existing `FROM users` query keeps working
// without needing an explicit JOIN. `roleId` is the real foreign key.
export const USER_COLUMNS = `
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

export async function createUser({
  username,
  fullName,
  roleId,
  password,
  mustChangePassword = true,
  db = pool,
}) {
  const result = await db.query(
    `INSERT INTO users (username, full_name, role_id, password_hash, must_change_password)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${USER_COLUMNS}`,
    [username, fullName, roleId, await hashPassword(password), mustChangePassword]
  );
  return result.rows[0];
}

// The permission keys a role holds, as a plain array of strings.
export async function loadPermissions(db, roleId) {
  const result = await db.query(
    'SELECT permission_key FROM role_permissions WHERE role_id = $1 ORDER BY permission_key',
    [roleId]
  );
  return result.rows.map((row) => row.permission_key);
}

// Attach the role's permission list onto a user object loaded via USER_COLUMNS.
export async function attachPermissions(user, db = pool) {
  if (!user) return user;
  user.permissions = await loadPermissions(db, user.roleId);
  return user;
}
