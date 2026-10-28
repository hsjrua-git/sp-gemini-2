import pool from '../db/pool.js';
import { USER_COLUMNS, attachPermissions } from '../lib/users.js';

export async function attachUser(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return next();

  const result = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND is_active`,
    [userId]
  );
  if (result.rowCount === 0) {
    await new Promise((resolve) => req.session.destroy(resolve));
    return next();
  }
  req.user = await attachPermissions(result.rows[0]);
  next();
}

export function requireLogin(req, res, next) {
  if (!req.user) {
    return res
      .status(401)
      .json({ error: 'Please sign in.', code: 'AUTH_SIGNIN_REQUIRED' });
  }
  next();
}

// True if the signed-in user's role holds this permission key.
export function userCan(req, key) {
  return Array.isArray(req.user?.permissions) && req.user.permissions.includes(key);
}

function permissionFor(policy, method) {
  const name = method === 'HEAD' ? 'GET' : method;
  return Object.hasOwn(policy, name) ? policy[name] : null;
}

// policy maps an HTTP method to either a permission key string, or `true`
// meaning "any signed-in user is allowed" (used for things like reading the
// period calendar or one's own preferences, which carry no dedicated key).
export function authorize(policy) {
  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: 'Please sign in.', code: 'AUTH_SIGNIN_REQUIRED' });
    }
    if (req.user.mustChangePassword) {
      return res.status(403).json({
        error: 'You must change your password first.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    const need = permissionFor(policy, req.method);
    if (need === null) {
      return res.status(403).json({
        error: 'You do not have permission to do that.',
        code: 'AUTH_FORBIDDEN',
      });
    }
    if (need !== true && !userCan(req, need)) {
      return res.status(403).json({
        error: 'You do not have permission to do that.',
        code: 'AUTH_FORBIDDEN',
      });
    }
    next();
  };
}

// For routes that need one specific key regardless of method.
export function requirePermission(key) {
  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: 'Please sign in.', code: 'AUTH_SIGNIN_REQUIRED' });
    }
    if (req.user.mustChangePassword) {
      return res.status(403).json({
        error: 'You must change your password first.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    if (!userCan(req, key)) {
      return res.status(403).json({
        error: 'You do not have permission to do that.',
        code: 'AUTH_FORBIDDEN',
      });
    }
    next();
  };
}

// For routes reachable by more than one permission (e.g. the role list is
// needed both to manage roles and to assign roles to users).
export function requireAnyPermission(...keys) {
  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: 'Please sign in.', code: 'AUTH_SIGNIN_REQUIRED' });
    }
    if (req.user.mustChangePassword) {
      return res.status(403).json({
        error: 'You must change your password first.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    if (!keys.some((key) => userCan(req, key))) {
      return res.status(403).json({
        error: 'You do not have permission to do that.',
        code: 'AUTH_FORBIDDEN',
      });
    }
    next();
  };
}
