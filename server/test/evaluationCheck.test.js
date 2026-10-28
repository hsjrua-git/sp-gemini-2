// Tests for the schema-4 evaluation shape and semantics: cells are keyed by
// membership-or-group + parameter, values are per-dimension integers or null
// (both value keys are required, comments optional ≤ 500 chars), `selected`
// decides whether the row exists, and `membershipId: null` targets the whole
// group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_COMMENT,
  MAX_ENTRIES,
  findProblems,
  normalizeComment,
  validateShape,
} from '../src/lib/evaluationCheck.js';

const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const M3 = '33333333-3333-4333-8333-333333333333';
const SPEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OPEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const parameters = new Map([
  [SPEED, { name: 'Speed', minValue: 0, maxValue: 10 }],
  [OPEN, { name: 'Open', minValue: null, maxValue: null }],
]);
const memberships = new Map([
  [M1, { studentName: 'One' }],
  [M2, { studentName: 'Two' }],
]);

const entry = (overrides = {}) => ({
  membershipId: M1,
  parameterId: SPEED,
  selected: true,
  qualityValue: 5,
  quantityValue: null,
  ...overrides,
});

const check = (entries) => findProblems({ entries, parameters, memberships });

test('comments are optional, trimmed, and blank means none', () => {
  assert.equal(normalizeComment('  hello  '), 'hello');
  assert.equal(normalizeComment(''), null);
  assert.equal(normalizeComment('   '), null);
  assert.equal(normalizeComment(null), null);
  assert.equal(normalizeComment(undefined), null);
  assert.equal(normalizeComment(42), undefined); // signals invalid
});

test('accepts a well-formed cell', () => {
  assert.equal(validateShape([entry()]), null);
  // Both value keys must exist even when unused; comments may be omitted.
  assert.equal(
    validateShape([
      {
        membershipId: null,
        parameterId: OPEN,
        selected: false,
        qualityValue: null,
        quantityValue: null,
      },
    ]),
    null
  );
});

test('rejects malformed requests', () => {
  assert.ok(validateShape([]));
  assert.ok(validateShape('nope'));
  assert.ok(validateShape([null]));
  assert.ok(validateShape([{ membershipId: M1 }]));
  // Identifiers
  assert.ok(validateShape([{ ...entry(), membershipId: 'x' }]));
  assert.ok(validateShape([{ ...entry(), membershipId: undefined }]));
  assert.ok(validateShape([{ ...entry(), parameterId: 'not-a-uuid' }]));
  // selected is required and boolean
  assert.ok(validateShape([{ ...entry(), selected: undefined }]));
  assert.ok(validateShape([{ ...entry(), selected: 1 }]));
  // Values must be present keys, integer-or-null, within the supported range
  const missingValue = { ...entry() };
  delete missingValue.qualityValue;
  assert.ok(validateShape([missingValue]));
  assert.ok(validateShape([{ ...entry(), qualityValue: 2.5 }]));
  assert.ok(validateShape([{ ...entry(), quantityValue: '5' }]));
  assert.ok(validateShape([{ ...entry(), qualityValue: 1e12 }]));
  assert.equal(validateShape([{ ...entry(), qualityValue: 1_000_000_000 }]), null);
  assert.ok(validateShape([{ ...entry(), quantityValue: -1_000_000_001 }]));
  // Comments, when present, must be text within the length cap
  assert.equal(MAX_COMMENT, 500);
  assert.ok(validateShape([{ ...entry(), qualityComment: 7 }]));
  assert.ok(validateShape([{ ...entry(), quantityComment: 'x'.repeat(501) }]));
  assert.equal(validateShape([{ ...entry(), qualityComment: 'x'.repeat(500) }]), null);
  assert.equal(validateShape([{ ...entry(), quantityComment: null }]), null);
});

test('one save may carry up to 5000 entries', () => {
  assert.equal(MAX_ENTRIES, 5000);
  const make = (count) => Array.from({ length: count }, () => entry());
  assert.equal(validateShape(make(MAX_ENTRIES)), null);
  assert.ok(validateShape(make(MAX_ENTRIES + 1)));
});

test('accepts valid cells, including the range limits and the group row', () => {
  assert.deepEqual(
    check([
      entry({ qualityValue: 0, quantityValue: 10 }), // inclusive limits
      entry({
        membershipId: M2,
        parameterId: OPEN,
        qualityValue: 12345,
        quantityValue: -7,
      }),
      entry({ membershipId: null, parameterId: OPEN, quantityValue: 3 }),
    ]),
    []
  );
});

test('null values skip the range checks', () => {
  assert.deepEqual(check([entry({ qualityValue: null, quantityValue: null })]), []);
});

test('flags values outside a parameter range, per dimension', () => {
  const problems = check([entry({ qualityValue: 11, quantityValue: -1 })]);
  assert.deepEqual(
    problems.map((p) => [p.index, p.message]),
    [
      [0, 'Speed must be at most 10.'],
      [0, 'Speed must be at least 0.'],
    ]
  );
});

test('flags a duplicate cell (same target and parameter) once', () => {
  const problems = check([
    entry(),
    entry({ qualityValue: 6 }),
    entry({ membershipId: null, parameterId: OPEN }),
    entry({ membershipId: null, parameterId: OPEN, qualityValue: 7 }),
  ]);
  assert.deepEqual(
    problems.map((p) => [p.index, p.message]),
    [
      [1, 'This target and parameter appear more than once.'],
      [3, 'This target and parameter appear more than once.'],
    ]
  );
});

test('flags targets and parameters the assignment does not know', () => {
  const problems = check([
    entry({ membershipId: M3 }),
    entry({ membershipId: null, parameterId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
  ]);
  assert.deepEqual(
    problems.map((p) => p.message),
    ['This target is not part of the assignment.', 'Parameter not found.']
  );
});

test('problems carry the entry’s index and cell identity', () => {
  assert.deepEqual(check([entry({ membershipId: M3 })]), [
    {
      index: 0,
      membershipId: M3,
      parameterId: SPEED,
      message: 'This target is not part of the assignment.',
    },
  ]);
});
