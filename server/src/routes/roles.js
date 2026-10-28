import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { isUuid } from '../lib/ids.js';
import {
  PERMISSIONS,
  PREREQUISITES,
  withPrerequisites,
} from '../lib/permissions.js';
import { requireAnyPermission } from '../middleware/auth.js';
import { parseNewRole, parseRoleUpdate } from '../validation/role.js';

const router = Router();
const UNIQUE_VIOLATION = '23505';

const GUARDED = [
  { key: 'users.manage', label: 'manage users' },
  { key: 'roles.manage', label: 'manage roles' },
];

// Reading the catalogue and the role list needs either permission; the mount
// in index.js lets any signed-in user through on GET, so re-check here.
const canRead = requireAnyPermission('users.manage', 'roles.manage');

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res
      .status(404)
      .json({ error: 'Role not found.', code: 'NOT_FOUND', params: { entity: 'role' } });
  }
  next();
});

// The fixed catalogue of permission keys and their prerequisites, so the role
// editor can render checkboxes and auto-tick prerequisites.
router.get('/catalog', canRead, (req, res) => {
  res.json({ permissions: PERMISSIONS, prerequisites: PREREQUISITES });
});

router.get('/', canRead, async (req, res) => {
  const result = await pool.query(
    `SELECT r.id,
            r.name,
            r.description,
            r.is_system AS "isSystem",
            r.created_at AS "createdAt",
            COALESCE(
              array_agg(rp.permission_key)
                FILTER (WHERE rp.permission_key IS NOT NULL),
              '{}'
            ) AS permissions,
            (SELECT count(*)::int FROM users u WHERE u.role_id = r.id)
              AS "userCount"
     FROM roles r
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     GROUP BY r.id
     ORDER BY r.is_system DESC, lower(r.name)`
  );
  res.json({ roles: result.rows });
});

async function guardedInvariantViolation(db) {
  for (const guard of GUARDED) {
    const result = await db.query(
      `SELECT count(*)::int AS count
       FROM users u
       JOIN role_permissions rp
         ON rp.role_id = u.role_id AND rp.permission_key = $1
       WHERE u.is_active`,
      [guard.key]
    );
    if (result.rows[0].count === 0) {
      return {
        error: `There must always be at least one active user who can ${guard.label}.`,
        code: 'ROLES_LAST_MANAGER',
        params: { permission: guard.key },
      };
    }
  }
  return null;
}

async function insertPermissions(db, roleId, keys) {
  if (keys.length === 0) return;
  const valuesSql = keys.map((_, index) => `($1, $${index + 2})`).join(', ');
  await db.query(
    `INSERT INTO role_permissions (role_id, permission_key) VALUES ${valuesSql}`,
    [roleId, ...keys]
  );
}

router.post('/', async (req, res) => {
  const parsed = parseNewRole(req.body);
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  const permissions = withPrerequisites(parsed.values.permissions);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roleResult = await client.query(
      `INSERT INTO roles (name, description, is_system)
       VALUES ($1, $2, false)
       RETURNING id, name, description, is_system AS "isSystem", created_at AS "createdAt"`,
      [parsed.values.name, parsed.values.description]
    );
    const role = roleResult.rows[0];
    await insertPermissions(client, role.id, permissions);
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'role.create',
      entityType: 'role',
      entityId: role.id,
      details: { name: role.name, permissions },
    });
    await client.query('COMMIT');
    res.status(201).json({ role: { ...role, permissions, userCount: 0 } });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({
        error: 'A role with that name already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  } finally {
    client.release();
  }
});

router.patch('/:id', async (req, res) => {
  const parsed = parseRoleUpdate(req.body);
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the role row first. We deliberately do NOT aggregate its
    // permissions in the same statement: PostgreSQL forbids FOR UPDATE
    // together with GROUP BY. Lock the single row, then read its permissions
    // in a follow-up query (same transaction, so the view is consistent).
    const locked = await client.query(
      `SELECT id, name, description, is_system AS "isSystem"
       FROM roles
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id]
    );
    if (locked.rowCount === 0) {
      await client.query('ROLLBACK');
      return res
        .status(404)
        .json({ error: 'Role not found.', code: 'NOT_FOUND', params: { entity: 'role' } });
    }
    const permsResult = await client.query(
      `SELECT COALESCE(
                array_agg(permission_key)
                  FILTER (WHERE permission_key IS NOT NULL),
                '{}'
              ) AS permissions
       FROM role_permissions
       WHERE role_id = $1`,
      [req.params.id]
    );
    const role = {
      ...locked.rows[0],
      permissions: permsResult.rows[0].permissions,
    };

    // The built-in Administrator role is fully locked: it is the one system
    // role that can manage roles, so letting anyone rename it or trim its
    // permissions is how an installation locks itself out. Identify it by that
    // capability rather than by name (names of other roles can change).
    if (role.isSystem && role.permissions.includes('roles.manage')) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'The Administrator role cannot be modified.',
        code: 'ROLES_SYSTEM_IMMUTABLE',
      });
    }

    let newPermissions = role.permissions;
    if ('permissions' in parsed.values) {
      newPermissions = withPrerequisites(parsed.values.permissions);
      // System roles must keep the keys that let anyone manage users and roles.
      if (role.isSystem) {
        for (const guard of GUARDED) {
          if (
            role.permissions.includes(guard.key) &&
            !newPermissions.includes(guard.key)
          ) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              error: `The ${role.name} role must keep the ability to ${guard.label}.`,
              code: 'ROLES_SYSTEM_MUST_KEEP',
              params: { role: role.name, permission: guard.key },
            });
          }
        }
      }
    }

    const name = parsed.values.name ?? role.name;
    const description = parsed.values.description ?? role.description;
    await client.query(
      `UPDATE roles SET name = $1, description = $2 WHERE id = $3`,
      [name, description, role.id]
    );

    if ('permissions' in parsed.values) {
      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [
        role.id,
      ]);
      await insertPermissions(client, role.id, newPermissions);
    }

    const violation = await guardedInvariantViolation(client);
    if (violation) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: violation.error,
        code: violation.code,
        params: violation.params,
      });
    }

    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'role.update',
      entityType: 'role',
      entityId: role.id,
      details: {
        name,
        ...(parsed.values.name && parsed.values.name !== role.name
          ? { renamedFrom: role.name }
          : {}),
        ...('permissions' in parsed.values
          ? { permissions: newPermissions }
          : {}),
      },
    });

    await client.query('COMMIT');
    res.json({
      role: {
        id: role.id,
        name,
        description,
        isSystem: role.isSystem,
        permissions: newPermissions,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({
        error: 'A role with that name already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id, name, is_system AS "isSystem",
              (SELECT count(*)::int FROM users u WHERE u.role_id = roles.id)
                AS "userCount"
       FROM roles WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');
      return res
        .status(404)
        .json({ error: 'Role not found.', code: 'NOT_FOUND', params: { entity: 'role' } });
    }
    const role = existing.rows[0];
    if (role.isSystem) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'System roles cannot be deleted.',
        code: 'ROLES_SYSTEM_NOT_DELETABLE',
      });
    }
    if (role.userCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Move its users to another role before deleting it.',
        code: 'ROLES_NOT_EMPTY',
      });
    }
    await client.query('DELETE FROM roles WHERE id = $1', [role.id]);
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'role.delete',
      entityType: 'role',
      entityId: role.id,
      details: { name: role.name },
    });
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;
