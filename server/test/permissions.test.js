import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const BASE = process.env.TEST_SERVER_URL ?? 'http://localhost:3000';
const NIL = '00000000-0000-0000-0000-000000000000';

// This is an integration suite: it talks to a running server + database. Plain
// `npm test` (node --test) discovers every *.test.js, so gate it behind a flag
// and skip cleanly there. `npm run test-permissions` sets RUN_INTEGRATION=1.
const RUN = process.env.RUN_INTEGRATION === '1';
const skip = RUN
  ? false
  : 'integration test — start the server and run `npm run test-permissions`';

function jar() {
  const store = new Map();
  return {
    header(response) {
      const set = response.headers.getSetCookie?.() ?? [];
      for (const line of set) {
        const [pair] = line.split(';');
        const [key, value] = pair.split('=');
        store.set(key, value);
      }
    },
    cookie() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    // The double-submit CSRF token the server handed us (see middleware/csrf.js).
    csrf() {
      return store.get('csrf');
    },
  };
}

const SAFE = /^(GET|HEAD|OPTIONS)$/i;

async function call(path, { method = 'GET', body, cookieJar } = {}) {
  // Mirror the browser: echo the CSRF cookie in the header on mutations.
  const csrfHeader =
    cookieJar && !SAFE.test(method) && cookieJar.csrf()
      ? { 'X-CSRF-Token': cookieJar.csrf() }
      : {};
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookieJar ? { Cookie: cookieJar.cookie() } : {}),
      ...csrfHeader,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  cookieJar?.header(response);
  return response;
}

async function loginAs(username, password) {
  const cookieJar = jar();
  const response = await call('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    cookieJar,
  });
  assert.equal(response.status, 200, `login as ${username} should succeed`);
  return cookieJar;
}

// One representative request per protected route.
const ROUTES = [
  { method: 'GET', path: '/api/students' },
  { method: 'POST', path: '/api/students', body: { fullName: 'Permission Test' } },
  { method: 'GET', path: `/api/students/${NIL}` },
  { method: 'PATCH', path: `/api/students/${NIL}`, body: { fullName: 'x' } },
  { method: 'DELETE', path: `/api/students/${NIL}` },
  { method: 'POST', path: '/api/students/import', body: { rows: [] } },
  { method: 'GET', path: '/api/parameters' },
  { method: 'POST', path: '/api/parameters', body: { code: 'PERM_X', name: 'x' } },
  { method: 'PATCH', path: `/api/parameters/${NIL}`, body: {} },
  { method: 'GET', path: `/api/periods?assignmentId=${NIL}` },
  { method: 'GET', path: `/api/evaluations?sessionId=${NIL}` },
  { method: 'PUT', path: '/api/evaluations/bulk', body: { sessionId: NIL, entries: [] } },
  { method: 'GET', path: `/api/results?assignmentId=${NIL}&periodSeq=1` },
  { method: 'GET', path: '/api/dashboard/trends' },
  { method: 'GET', path: '/api/saved-views' },
  { method: 'POST', path: '/api/saved-views', body: {} },
  { method: 'PUT', path: `/api/saved-views/${NIL}`, body: {} },
  { method: 'DELETE', path: `/api/saved-views/${NIL}` },
  { method: 'GET', path: '/api/preferences' },
  { method: 'PUT', path: '/api/preferences', body: {} },
  { method: 'DELETE', path: '/api/preferences' },
  { method: 'GET', path: '/api/audit' },
  { method: 'GET', path: '/api/users' },
  { method: 'POST', path: '/api/users', body: {} },
  { method: 'PATCH', path: `/api/users/${NIL}`, body: {} },
  { method: 'POST', path: `/api/users/${NIL}/reset-password` },
  // Roles
  { method: 'GET', path: '/api/roles' },
  { method: 'GET', path: '/api/roles/catalog' },
  { method: 'POST', path: '/api/roles', body: { name: 'x', permissions: [] } },
  { method: 'PATCH', path: `/api/roles/${NIL}`, body: {} },
  { method: 'DELETE', path: `/api/roles/${NIL}` },
  // Groups
  { method: 'GET', path: '/api/groups' },
  { method: 'POST', path: '/api/groups', body: { name: 'x' } },
  { method: 'PATCH', path: `/api/groups/${NIL}`, body: {} },
  { method: 'DELETE', path: `/api/groups/${NIL}` },
  { method: 'GET', path: `/api/groups/${NIL}/members` },
  { method: 'PUT', path: `/api/groups/${NIL}/members`, body: { add: [], remove: [] } },
  // Custom fields
  { method: 'GET', path: '/api/field-definitions' },
  { method: 'POST', path: '/api/field-definitions', body: { label: 'x', fieldType: 'text' } },
  { method: 'PATCH', path: `/api/field-definitions/${NIL}`, body: {} },
  { method: 'DELETE', path: `/api/field-definitions/${NIL}` },
  // Teachers, Schedule, Cafe, Accounting, Agent
  { method: 'GET', path: '/api/teachers' },
  { method: 'POST', path: '/api/teachers', body: { fullName: 'x' } },
  { method: 'GET', path: '/api/intervals' },
  { method: 'GET', path: '/api/assignments' },
  { method: 'GET', path: '/api/sessions' },
  { method: 'GET', path: '/api/tasks' },
  { method: 'GET', path: '/api/task-templates' },
  { method: 'GET', path: '/api/alerts' },
  { method: 'GET', path: '/api/cafe/products' },
  { method: 'GET', path: '/api/cafe/balances' },
  { method: 'POST', path: '/api/cafe/balances', body: {} },
  { method: 'GET', path: '/api/accounting/accounts' },
  { method: 'GET', path: '/api/accounting/periods' },
  { method: 'GET', path: '/api/agent' },
];

let admin;
let staff;
let viewer;

before(async () => {
  if (!RUN) return;
  execSync('npm run migrate', { stdio: 'ignore' });
  admin = await loginAs('admin', process.env.TEST_ADMIN_PASSWORD ?? 'correct-horse-battery');
  staff = await loginAs('staff1', process.env.TEST_STAFF_PASSWORD ?? 'change-me');
  viewer = await loginAs('viewer1', process.env.TEST_VIEWER_PASSWORD ?? 'change-me');
});

test('every route in the list refuses an unauthenticated request', { skip }, async () => {
  for (const route of ROUTES) {
    const response = await call(route.path, { method: route.method, body: route.body });
    assert.equal(
      response.status,
      401,
      `${route.method} ${route.path} should require sign-in, got ${response.status}`
    );
  }
});

test('a signed-in viewer never gets a 401, and privileged routes stay closed to staff', { skip }, async () => {
  // Routes the Staff role must NOT reach (it lacks the key): everything gated
  // by students.delete, data.import, parameters.manage, settings.manage,
  // users.manage, audit.view, roles.manage, groups.manage, fields.manage.
  // GET /api/roles(+/catalog) is guarded inside the router by users.manage OR
  // roles.manage, so staff gets 403 there too.
  const adminOnly = new Set([
    `DELETE /api/students/${NIL}`,
    'POST /api/students/import',
    'POST /api/parameters',
    `PATCH /api/parameters/${NIL}`,
    'GET /api/audit',
    'GET /api/users',
    'POST /api/users',
    `PATCH /api/users/${NIL}`,
    `POST /api/users/${NIL}/reset-password`,
    'GET /api/roles',
    'GET /api/roles/catalog',
    'POST /api/roles',
    `PATCH /api/roles/${NIL}`,
    `DELETE /api/roles/${NIL}`,
    'POST /api/groups',
    `PATCH /api/groups/${NIL}`,
    `DELETE /api/groups/${NIL}`,
    'POST /api/field-definitions',
    `PATCH /api/field-definitions/${NIL}`,
    `DELETE /api/field-definitions/${NIL}`,
    'POST /api/teachers',
  ]);

  for (const route of ROUTES) {
    const asViewer = await call(route.path, {
      method: route.method,
      body: route.body,
      cookieJar: viewer,
    });
    assert.notEqual(
      asViewer.status,
      401,
      `${route.method} ${route.path} rejected a signed-in viewer entirely`
    );

    const key = `${route.method} ${route.path}`;
    if (adminOnly.has(key)) {
      const asStaff = await call(route.path, {
        method: route.method,
        body: route.body,
        cookieJar: staff,
      });
      assert.equal(
        asStaff.status,
        403,
        `${key} should be closed to staff, but staff got ${asStaff.status}`
      );
    }
  }
});

test('staff can assign group members (groups.assign), even though they cannot manage groups', { skip }, async () => {
  const response = await call(`/api/groups/${NIL}/members`, {
    method: 'PUT',
    body: { add: [], remove: [] },
    cookieJar: staff,
  });
  assert.notEqual(response.status, 401, 'staff is signed in');
  assert.notEqual(
    response.status,
    403,
    `staff should hold groups.assign, got ${response.status}`
  );
});

test('admin can reach every route without a permission error', { skip }, async () => {
  for (const route of ROUTES) {
    const response = await call(route.path, {
      method: route.method,
      body: route.body,
      cookieJar: admin,
    });
    assert.notEqual(response.status, 401, `${route.method} ${route.path} rejected admin`);
    assert.notEqual(response.status, 403, `${route.method} ${route.path} rejected admin`);
  }
});
