import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNewTeacher, parseTeacherUpdate } from '../src/validation/teacher.js';

test('a new teacher needs a full identity', () => {
  assert.deepEqual(
    parseNewTeacher({ fullName: ' Sara  Ahmadi ', birthDate: '1985-03-12', nationalId: '0012345678' }),
    { value: { fullName: 'Sara Ahmadi', birthDate: '1985-03-12', nationalId: '0012345678' } }
  );

  assert.ok(parseNewTeacher({ birthDate: '1985-03-12', nationalId: '0012345678' }).error, 'missing name');
  assert.ok(parseNewTeacher({ fullName: 'Sara Ahmadi', nationalId: '0012345678' }).error, 'missing birth date');
  assert.ok(parseNewTeacher({ fullName: 'Sara Ahmadi', birthDate: '1985-03-12' }).error, 'missing national ID');
  assert.ok(
    parseNewTeacher({ fullName: 'Sara Ahmadi', birthDate: '2999-01-01', nationalId: '0012345678' }).error,
    'future birth date'
  );
});

test('teacher updates are partial but validated', () => {
  assert.deepEqual(parseTeacherUpdate({ fullName: 'New Name' }), {
    value: { fullName: 'New Name' },
  });
  assert.deepEqual(parseTeacherUpdate({ nationalId: '0012345678' }), {
    value: { nationalId: '0012345678' },
  });
  assert.deepEqual(parseTeacherUpdate({ archived: true }), {
    value: { archived: true },
  });
  assert.ok(parseTeacherUpdate({ nationalId: '123' }).error, 'bad national ID');
  assert.ok(parseTeacherUpdate({ archived: 'yes' }).error, 'non-boolean archived');
  assert.ok(parseTeacherUpdate({}).error, 'nothing to change');
  assert.equal(parseTeacherUpdate(undefined).code, 'VALIDATION_NOTHING_TO_CHANGE');
  assert.equal(parseTeacherUpdate(null).code, 'VALIDATION_NOTHING_TO_CHANGE');
});
