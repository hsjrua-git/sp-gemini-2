import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskFields } from '../src/validation/schedule.js';

test('a task needs a trimmed title of 1-120 characters', () => {
  assert.deepEqual(parseTaskFields({ title: '  Weekly   quiz ' }), {
    value: { title: 'Weekly quiz' },
  });
  assert.ok(parseTaskFields({}).error, 'missing title');
  assert.ok(parseTaskFields({ title: '   ' }).error, 'whitespace-only title');
  assert.ok(parseTaskFields({ title: 'x'.repeat(121) }).error, 'over 120 characters');
});

test('descriptions are optional and blank clears to null', () => {
  assert.deepEqual(
    parseTaskFields({ title: 'T', description: '  read chapter 3 ' }),
    { value: { title: 'T', description: 'read chapter 3' } },
  );
  assert.deepEqual(
    parseTaskFields({ title: 'T', description: '   ' }),
    { value: { title: 'T', description: null } },
  );
  assert.ok(
    parseTaskFields({ title: 'T', description: 'x'.repeat(2001) }).error,
    'over 2000 characters',
  );
});

test('partial updates validate only the carried fields', () => {
  assert.deepEqual(
    parseTaskFields({ description: 'new text' }, { partial: true }),
    { value: { description: 'new text' } },
  );
  assert.deepEqual(
    parseTaskFields({ sortOrder: 4 }, { partial: true }),
    { value: { sortOrder: 4 } },
  );
  assert.ok(
    parseTaskFields({ sortOrder: -1 }, { partial: true }).error,
    'negative sort order',
  );
  // A partial update may carry no title at all — only the carried fields run.
  assert.deepEqual(
    parseTaskFields({ description: 'x' }, { partial: true }),
    { value: { description: 'x' } },
  );
});
