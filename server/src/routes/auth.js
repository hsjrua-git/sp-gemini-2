import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import pool from '../db/pool.js';
import {
  MAX_PASSWORD_LENGTH,
  hashPassword,
  validateNewPassword,
  verifyPassword,
} from '../lib/passwords.js';
import { USER_COLUMNS, attachPermissions } from '../lib/users.js';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

let dummyHash;
async function getDummyHash() {
  dummyHash ??= await hashPassword('a password that nobody uses');
  return dummyHash;
}

function viaCallback(run) {
  return new Promise((resolve, reject) => {
    run((err) => (err ? reject(err) : resolve()));
  });
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many failed attempts. Please wait 15 minutes and try again.',
    code: 'AUTH_RATE_LIMITED',
  },
});

router.post('/login', loginLimiter, async (req, res) => {
  const username =
    typeof req.body?.username === 'string'
      ? req.body.username.trim().toLowerCase()
      : '';
  const password =
    typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password || password.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: 'Enter your username and password.',
      code: 'AUTH_CREDENTIALS_REQUIRED',
    });
  }

  const result = await pool.query(
    `SELECT ${USER_COLUMNS}, password_hash AS "passwordHash"
     FROM users WHERE lower(username) = $1`,
    [username]
  );
  const found = result.rows[0];

  const hash = found ? found.passwordHash : await getDummyHash();
  const passwordOk = await verifyPassword(hash, password);
  if (!found || !found.isActive || !passwordOk) {
    return res
      .status(401)
      .json({ error: 'Wrong username or password.', code: 'AUTH_INVALID_CREDENTIALS' });
  }

  await viaCallback((done) => req.session.regenerate(done));
  req.session.userId = found.id;
  await viaCallback((done) => req.session.save(done));

  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [
    found.id,
  ]);

  const { passwordHash, ...user } = found;
  await attachPermissions(user);
  res.json({ user });
});

router.post('/logout', async (req, res) => {
  await viaCallback((done) => req.session.destroy(done));
  res.clearCookie('sid');
  res.status(204).end();
});

router.get('/me', (req, res) => {
  if (!req.user) {
    return res
      .status(401)
      .json({ error: 'Not signed in.', code: 'AUTH_SIGNIN_REQUIRED' });
  }
  res.json({ user: req.user });
});

router.post('/change-password', requireLogin, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};

  if (
    typeof currentPassword !== 'string' ||
    currentPassword === '' ||
    currentPassword.length > MAX_PASSWORD_LENGTH
  ) {
    return res.status(400).json({
      error: 'Enter your current password.',
      code: 'AUTH_PASSWORD_CURRENT_REQUIRED',
    });
  }
  const problem = validateNewPassword(newPassword, {
    username: req.user.username,
  });
  if (problem) {
    return res.status(400).json({
      error: problem.error,
      code: problem.code,
      params: problem.params,
    });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({
      error: 'The new password must be different from the current one.',
      code: 'AUTH_PASSWORD_SAME_AS_CURRENT',
    });
  }

  const found = await pool.query(
    'SELECT password_hash AS "passwordHash" FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!(await verifyPassword(found.rows[0].passwordHash, currentPassword))) {
    return res.status(400).json({
      error: 'The current password is incorrect.',
      code: 'AUTH_PASSWORD_CURRENT_INCORRECT',
    });
  }

  await pool.query(
    `UPDATE users
     SET password_hash = $1, must_change_password = false, updated_at = now()
     WHERE id = $2`,
    [await hashPassword(newPassword), req.user.id]
  );
  await pool.query(
    `DELETE FROM user_sessions WHERE (sess->>'userId') = $1 AND sid <> $2`,
    [req.user.id, req.sessionID]
  );

  res.json({ user: { ...req.user, mustChangePassword: false } });
});

export default router;