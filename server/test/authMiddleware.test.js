import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorize,
  requireAnyPermission,
  requireLogin,
  requirePermission,
  userCan,
} from '../src/middleware/auth.js';

// Minimal req/res doubles. `run` returns the status the middleware produced, or
// 'next' if it passed the request through.
function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function run(mw, req) {
  const res = makeRes();
  let passed = false;
  mw(req, res, () => {
    passed = true;
  });
  return { outcome: passed ? 'next' : res.statusCode, res };
}

const viewer = { permissions: ['students.view', 'scores.view'] };

test('userCan reflects the permission array', () => {
  assert.equal(userCan({ user: viewer }, 'students.view'), true);
  assert.equal(userCan({ user: viewer }, 'students.delete'), false);
  assert.equal(userCan({}, 'students.view'), false); // no user
});

test('requireLogin gates on a signed-in user', () => {
  assert.equal(run(requireLogin, {}).outcome, 401);
  assert.equal(run(requireLogin, { user: viewer }).outcome, 'next');
});

test('authorize: unauthenticated is 401, before any permission check', () => {
  const mw = authorize({ GET: 'students.view' });
  assert.equal(run(mw, { method: 'GET' }).outcome, 401);
});

test('authorize: a must-change-password user is blocked with a code', () => {
  const mw = authorize({ GET: true });
  const { outcome, res } = run(mw, {
    method: 'GET',
    user: { permissions: [], mustChangePassword: true },
  });
  assert.equal(outcome, 403);
  assert.equal(res.body.code, 'PASSWORD_CHANGE_REQUIRED');
});

test('authorize: a method absent from the policy is refused', () => {
  const mw = authorize({ GET: 'students.view' });
  assert.equal(run(mw, { method: 'DELETE', user: viewer }).outcome, 403);
});

test('authorize: `true` allows any signed-in user', () => {
  const mw = authorize({ GET: true });
  assert.equal(run(mw, { method: 'GET', user: { permissions: [] } }).outcome, 'next');
});

test('authorize: a key is enforced against the user permissions', () => {
  const mw = authorize({ POST: 'students.create' });
  assert.equal(run(mw, { method: 'POST', user: viewer }).outcome, 403);
  assert.equal(
    run(mw, { method: 'POST', user: { permissions: ['students.create'] } }).outcome,
    'next',
  );
});

test('authorize: HEAD is treated as GET', () => {
  const mw = authorize({ GET: 'students.view' });
  assert.equal(run(mw, { method: 'HEAD', user: viewer }).outcome, 'next');
});

test('requirePermission enforces one specific key regardless of method', () => {
  const mw = requirePermission('users.manage');
  assert.equal(run(mw, {}).outcome, 401);
  assert.equal(run(mw, { user: viewer }).outcome, 403);
  assert.equal(
    run(mw, { user: { permissions: ['users.manage'] } }).outcome,
    'next',
  );
});

test('requireAnyPermission passes when at least one key is held', () => {
  const mw = requireAnyPermission('users.manage', 'roles.manage');
  assert.equal(run(mw, { user: viewer }).outcome, 403);
  assert.equal(
    run(mw, { user: { permissions: ['roles.manage'] } }).outcome,
    'next',
  );
});
