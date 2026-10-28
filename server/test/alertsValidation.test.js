import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAlertPatch,
  parseAlertStatus,
} from '../src/validation/alerts.js';

test('alert status defaults to open and accepts only the three slices', () => {
  assert.deepEqual(parseAlertStatus(undefined), { value: 'open' });
  assert.deepEqual(parseAlertStatus('resolved'), { value: 'resolved' });
  assert.deepEqual(parseAlertStatus('all'), { value: 'all' });
  assert.ok(parseAlertStatus('OPEN').error, 'case-sensitive');
  assert.ok(parseAlertStatus('garbage').error, 'unknown slice');
});

test('alert patches carry exactly one boolean: resolved', () => {
  assert.deepEqual(parseAlertPatch({ resolved: true }), {
    value: { resolved: true },
  });
  assert.deepEqual(parseAlertPatch({ resolved: false }), {
    value: { resolved: false },
  });
  assert.ok(parseAlertPatch({}).error, 'missing resolved');
  assert.ok(parseAlertPatch({ resolved: 'yes' }).error, 'non-boolean');
  assert.ok(parseAlertPatch(null).error, 'missing body');
});
