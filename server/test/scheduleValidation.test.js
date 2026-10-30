import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAssignmentBody,
  parseIntervalBody,
} from '../src/validation/schedule.js';

const TEACHER = '11111111-1111-4111-8111-111111111111';
const INTERVAL = '22222222-2222-4222-8222-222222222222';
const GROUP = '33333333-3333-4333-8333-333333333333';

test('intervals are described in days or months, never raw SQL', () => {
  assert.deepEqual(parseIntervalBody({ name: ' Weekly ', everyDays: 7 }), {
    value: { name: 'Weekly', every: '7 days' },
  });
  assert.deepEqual(parseIntervalBody({ name: 'Monthly', everyMonths: 1 }), {
    value: { name: 'Monthly', every: '1 month' },
  });
  assert.ok(parseIntervalBody({ name: 'Odd', everyDays: 0 }).error);
  assert.ok(parseIntervalBody({ name: 'Odd', everyMonths: 25 }).error);
  assert.ok(parseIntervalBody({ everyDays: 7 }).error, 'name required');
  assert.ok(parseIntervalBody({}).error, 'nothing to change');
  assert.deepEqual(
    parseIntervalBody({ sortOrder: 5 }, { partial: true }),
    { value: { sortOrder: 5 } },
  );
});

test('an assignment needs teacher, interval, anchor and exactly one target', () => {
  const good = parseAssignmentBody({
    teacherId: TEACHER,
    intervalId: INTERVAL,
    groupId: GROUP,
    anchorDate: '2026-10-01',
  });
  assert.deepEqual(good, {
    value: {
      teacherId: TEACHER,
      intervalId: INTERVAL,
      anchorDate: '2026-10-01',
      name: null,
      code: null,
      groupId: GROUP,
    },
  });

  assert.ok(
    parseAssignmentBody({ teacherId: TEACHER, intervalId: INTERVAL, anchorDate: '2026-10-01' }).error,
    'no target',
  );
  assert.ok(
    parseAssignmentBody({ teacherId: TEACHER, intervalId: INTERVAL, anchorDate: '2026-10-01', groupId: GROUP, membershipId: 'x' }).error,
    'two targets',
  );
  assert.ok(
    parseAssignmentBody({ intervalId: INTERVAL, groupId: GROUP, anchorDate: '2026-10-01' }).error,
    'no teacher',
  );
  assert.ok(
    parseAssignmentBody({ teacherId: TEACHER, groupId: GROUP, anchorDate: '01/10/2026' }).error,
    'bad anchor date',
  );
});

test('assignment updates stay partial and keep the target coherent', () => {
  assert.deepEqual(
    parseAssignmentBody({ anchorDate: '2026-11-01' }, { partial: true }),
    { value: { anchorDate: '2026-11-01' } },
  );
  assert.deepEqual(
    parseAssignmentBody({ name: '  Monday   maths ' }, { partial: true }),
    { value: { name: 'Monday maths' } },
  );
  assert.deepEqual(
    parseAssignmentBody({ groupId: null, membershipId: 'abc' }, { partial: true }),
    { value: { groupId: null, membershipId: 'abc' } },
  );
  assert.ok(
    parseAssignmentBody({ archived: 'yes' }, { partial: true }).error,
    'non-boolean archived',
  );
});
