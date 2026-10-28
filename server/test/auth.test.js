import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMISSION_KEYS,
  isPermissionKey,
  withPrerequisites,
  missingPrerequisites,
} from '../src/lib/permissions.js';

test('every permission key is unique and well-formed', () => {
  const seen = new Set();
  for (const key of PERMISSION_KEYS) {
    assert.match(key, /^[a-z]+\.[a-z_]+$/);
    assert.equal(seen.has(key), false, `duplicate key ${key}`);
    seen.add(key);
  }
});

test('isPermissionKey only accepts known keys', () => {
  assert.equal(isPermissionKey('students.view'), true);
  assert.equal(isPermissionKey('students.fly'), false);
  assert.equal(isPermissionKey(5), false);
  assert.equal(isPermissionKey('toString'), false);
});

test('withPrerequisites pulls in required keys transitively', () => {
  const expanded = new Set(withPrerequisites(['scores.override']));
  // scores.override -> scores.enter -> students.view + parameters.view
  assert.ok(expanded.has('scores.override'));
  assert.ok(expanded.has('scores.enter'));
  assert.ok(expanded.has('students.view'));
  assert.ok(expanded.has('parameters.view'));
});

test('scores.enter does NOT drag in scores.view (blind entry allowed)', () => {
  const expanded = new Set(withPrerequisites(['scores.enter']));
  assert.equal(expanded.has('scores.view'), false);
});

test('data.export includes every read capability its page and cube require', () => {
  const expanded = new Set(withPrerequisites(['data.export']));
  assert.ok(expanded.has('students.view'));
  assert.ok(expanded.has('scores.view'));
  assert.ok(expanded.has('parameters.view'));
});

test('missingPrerequisites finds gaps in a chosen set', () => {
  const gaps = missingPrerequisites(['scores.enter']);
  const needed = gaps.map((gap) => gap.needs);
  assert.ok(needed.includes('students.view'));
  assert.ok(needed.includes('parameters.view'));

  assert.deepEqual(
    missingPrerequisites(['students.view', 'parameters.view', 'scores.enter']),
    []
  );
});
