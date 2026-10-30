import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { isUuid } from '../lib/ids.js';
import { generatePassword, hashPassword } from '../lib/passwords.js';
import { checkUserChange } from '../lib/userRules.js';
import { lockManagerInvariant } from '../lib/managerInvariant.js';
import { USER_COLUMNS, createUser } from '../lib/users.js';
import { parseNewUser, parseUserUpdate } from '../validation/user.js';

const router = Router();
const UNIQUE_VIOLATION = '23505';

// Permissions that must never vanish from every active account at once.
const GUARDED_PERMISSIONS = [
  { key: 'users.manage', label: 'manage users' },
  { key: 'roles.manage', label: 'manage roles' },
];

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res
      .status(404)
      .json({ error: 'User not found.', code: 'NOT_FOUND', params: { entity: 'user' } });
  }
  next();
});

router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT ${USER_COLUMNS}
     FROM users
     ORDER BY is_active DESC, lower(username)`
  );
  res.json({ users: result.rows });
});

async function roleExists(db, roleId) {
  const result = await db.query('SELECT 1 FROM roles WHERE id = $1', [roleId]);
  return result.rowCount > 0;
}

async function roleHasPermission(db, roleId, key) {
  const result = await db.query(
    'SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_key = $2',
    [roleId, key]
  );
  return result.rowCount > 0;
}

async function countOtherActiveWithPermission(db, key, excludeUserId) {
  const result = await db.query(
    `SELECT count(*)::int AS count
     FROM users u
     JOIN role_permissions rp
       ON rp.role_id = u.role_id AND rp.permission_key = $1
     WHERE u.is_active AND u.id <> $2`,
    [key, excludeUserId]
  );
  return result.rows[0].count;
}

router.post('/', async (req, res) => {
  const parsed = parseNewUser(req.body);
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const temporaryPassword = generatePassword();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockManagerInvariant(client);
    if (!(await roleExists(client, parsed.values.roleId))) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'That role no longer exists.',
        code: 'NOT_FOUND',
        params: { entity: 'role' },
      });
    }
    const user = await createUser({
      ...parsed.values,
      password: temporaryPassword,
      mustChangePassword: true,
      db: client,
    });
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      details: {
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      },
    });
    await client.query('COMMIT');
    res.status(201).json({ user, temporaryPassword });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({
        error: 'That username already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  } finally {
    client.release();
  }
});

router.patch('/:id', async (req, res) => {
  const parsed = parseUserUpdate(req.body);
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockManagerInvariant(client);

    const targetResult = await client.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (targetResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res
        .status(404)
        .json({ error: 'User not found.', code: 'NOT_FOUND', params: { entity: 'user' } });
    }
    const target = targetResult.rows[0];

    if (parsed.values.roleId && !(await roleExists(client, parsed.values.roleId))) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'That role no longer exists.',
        code: 'NOT_FOUND',
        params: { entity: 'role' },
      });
    }

    const newRoleId = parsed.values.roleId ?? target.roleId;
    const guards = [];
    for (const guard of GUARDED_PERMISSIONS) {
      guards.push({
        key: guard.key,
        label: guard.label,
        othersActiveWithKey: await countOtherActiveWithPermission(
          client,
          guard.key,
          target.id
        ),
        newRoleHasKey: await roleHasPermission(client, newRoleId, guard.key),
      });
    }

    const problem = checkUserChange({
      actorId: req.user.id,
      target,
      changes: parsed.values,
      guards,
    });
    if (problem) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: problem.error,
        code: problem.code,
        params: problem.params,
      });
    }

    const columns = {
      fullName: 'full_name',
      roleId: 'role_id',
      isActive: 'is_active',
    };
    const entries = Object.entries(parsed.values);
    const assignments = entries.map(
      ([key], index) => `${columns[key]} = $${index + 1}`
    );
    const values = entries.map(([, value]) => value);

    const updated = await client.query(
      `UPDATE users
       SET ${assignments.join(', ')}, updated_at = now()
       WHERE id = $${values.length + 1}
       RETURNING ${USER_COLUMNS}`,
      [...values, req.params.id]
    );
    const user = updated.rows[0];

    const changes = {};
    if ('fullName' in parsed.values && target.fullName !== user.fullName) {
      changes.fullName = { from: target.fullName, to: user.fullName };
    }
    if ('roleId' in parsed.values && target.roleId !== user.roleId) {
      changes.role = { from: target.role, to: user.role };
    }
    if ('isActive' in parsed.values && target.isActive !== user.isActive) {
      changes.isActive = { from: target.isActive, to: user.isActive };
    }

    if (Object.keys(changes).length > 0) {
      if (changes.isActive && user.isActive === false) {
        await client.query(
          `DELETE FROM user_sessions WHERE (sess->>'userId') = $1`,
          [user.id]
        );
      }
      await recordAudit(client, {
        userId: req.user.id,
        actor: req.user.username,
        action: 'user.update',
        entityType: 'user',
        entityId: user.id,
        details: { username: user.username, changes },
      });
    }

    await client.query('COMMIT');
    res.json({ user });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.post('/:id/reset-password', async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(409).json({
      error: 'Use "Change password" for your own account.',
      code: 'USERS_SELF_PASSWORD_RESET',
    });
  }

  const temporaryPassword = generatePassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = true, updated_at = now()
       WHERE id = $2
       RETURNING ${USER_COLUMNS}`,
      [passwordHash, req.params.id]
    );
    if (updated.rowCount === 0) {
      await client.query('ROLLBACK');
      return res
        .status(404)
        .json({ error: 'User not found.', code: 'NOT_FOUND', params: { entity: 'user' } });
    }
    const user = updated.rows[0];

    await client.query(
      `DELETE FROM user_sessions WHERE (sess->>'userId') = $1`,
      [user.id]
    );
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'user.password_reset',
      entityType: 'user',
      entityId: user.id,
      details: { username: user.username },
    });
    await client.query('COMMIT');
    res.json({ user, temporaryPassword });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;
