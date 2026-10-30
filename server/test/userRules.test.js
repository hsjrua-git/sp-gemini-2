import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUserChange } from '../src/lib/userRules.js';
import { parseNewUser, parseUserUpdate } from '../src/validation/user.js';

const ADMIN_ROLE = '11111111-1111-4111-8111-111111111111';
const STAFF_ROLE = '22222222-2222-4222-8222-222222222222';
const VIEWER_ROLE = '33333333-3333-4333-8333-333333333333';

const admin = { id: 'a1', roleId: ADMIN_ROLE, isActive: true };
const staff = { id: 's1', roleId: STAFF_ROLE, isActive: true };

// Guards where this role is the only one holding the critical permissions.
const soleGuards = [
  { key: 'users.manage', label: 'manage users', othersActiveWithKey: 0, newRoleHasKey: true },
  { key: 'roles.manage', label: 'manage roles', othersActiveWithKey: 0, newRoleHasKey: true },
];
// Guards where others also hold the permissions.
const safeGuards = [
  { key: 'users.manage', label: 'manage users', othersActiveWithKey: 2, newRoleHasKey: false },
  { key: 'roles.manage', label: 'manage roles', othersActiveWithKey: 2, newRoleHasKey: false },
];

test('you cannot demote or deactivate yourself', () => {
  assert.ok(
    checkUserChange({ actorId: 'a1', target: admin, changes: { roleId: STAFF_ROLE }, guards: safeGuards })
  );
  assert.ok(
    checkUserChange({ actorId: 'a1', target: admin, changes: { isActive: false }, guards: safeGuards })
  );
});

test('you can still change your own name', () => {
  assert.equal(
    checkUserChange({ actorId: 'a1', target: admin, changes: { fullName: 'New Name' }, guards: soleGuards }),
    null
  );
});

test('the last user who can manage users/roles cannot be removed', () => {
  // Deactivating the only admin: target would no longer hold either key.
  const guards = [
    { key: 'users.manage', label: 'manage users', othersActiveWithKey: 0, newRoleHasKey: true },
    { key: 'roles.manage', label: 'manage roles', othersActiveWithKey: 0, newRoleHasKey: true },
  ];
  assert.ok(
    checkUserChange({ actorId: 'a2', target: admin, changes: { isActive: false }, guards })
  );
  // Demoting the only admin to a role without the keys.
  const demoteGuards = [
    { key: 'users.manage', label: 'manage users', othersActiveWithKey: 0, newRoleHasKey: false },
    { key: 'roles.manage', label: 'manage roles', othersActiveWithKey: 0, newRoleHasKey: false },
  ];
  assert.ok(
    checkUserChange({ actorId: 'a2', target: admin, changes: { roleId: VIEWER_ROLE }, guards: demoteGuards })
  );
});

test('changes are allowed when someone else keeps the keys', () => {
  assert.equal(
    checkUserChange({ actorId: 'a2', target: admin, changes: { isActive: false }, guards: safeGuards }),
    null
  );
  assert.equal(
    checkUserChange({ actorId: 'a1', target: staff, changes: { roleId: ADMIN_ROLE }, guards: safeGuards }),
    null
  );
});

test('new users are validated and normalised', () => {
  assert.deepEqual(
    parseNewUser({ username: ' Tina.T ', fullName: '  Tina   Teacher ', roleId: STAFF_ROLE }),
    { values: { username: 'tina.t', fullName: 'Tina Teacher', roleId: STAFF_ROLE } }
  );
});

test('new users with bad details are refused', () => {
  assert.ok(parseNewUser({ username: 'ab', fullName: 'X', roleId: STAFF_ROLE }).error);
  assert.ok(parseNewUser({ username: 'okname', fullName: '   ', roleId: STAFF_ROLE }).error);
  assert.ok(parseNewUser({ username: 'okname', fullName: 'X', roleId: 'not-a-uuid' }).error);
  assert.ok(parseNewUser(undefined).error);
});

test('updates accept only known fields', () => {
  assert.deepEqual(parseUserUpdate({ roleId: VIEWER_ROLE }), {
    values: { roleId: VIEWER_ROLE },
  });
  assert.deepEqual(
    parseUserUpdate({ isActive: false, fullName: ' New  Name ' }),
    { values: { fullName: 'New Name', isActive: false } }
  );
  assert.ok(parseUserUpdate({}).error);
  assert.ok(parseUserUpdate({ username: 'x' }).error);
  assert.ok(parseUserUpdate({ isActive: 'no' }).error);
  assert.ok(parseUserUpdate({ roleId: 'boss' }).error);
  assert.ok(parseUserUpdate(null).error);
});
