// Tests for the schema-4 saved-view config: a view pins one assignment's
// grid — which period (null = the assignment's latest), which dimension feeds
// the value columns and filters, the visible columns, their filters, the
// sort and the search text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRequest } from '../src/lib/auditRules.js';
import {
  MAX_VIEWS_PER_USER,
  parseViewConfig,
  parseViewName,
} from '../src/lib/savedViews.js';

const ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const ID2 = '11111111-1111-4111-8111-111111111111';
const ID3 = '22222222-2222-4222-8222-222222222222';

const DEFAULTS = {
  assignmentId: ID,
  seq: null,
  dimension: 'quality',
  parameterIds: [],
  filters: [],
  sort: { key: 'name', direction: 'asc' },
  search: '',
  showChange: false,
};

const config = (over = {}) => parseViewConfig({ assignmentId: ID, ...over });

test('a full valid view config is accepted and normalised', () => {
  const result = parseViewConfig({
    assignmentId: ID,
    seq: 7,
    dimension: 'quantity',
    parameterIds: [ID2],
    filters: [
      { parameterId: ID2, op: 'lt', value: 5, extra: 'x' },
      { parameterId: ID3, op: 'missing', value: 99 },
    ],
    sort: { key: ID2, direction: 'desc', junk: 1 },
    search: '  ana ',
    showChange: true,
    unknown: 'dropped',
  });
  assert.deepEqual(result, {
    value: {
      assignmentId: ID,
      seq: 7,
      dimension: 'quantity',
      parameterIds: [ID2],
      filters: [
        { parameterId: ID2, op: 'lt', value: 5 },
        { parameterId: ID3, op: 'missing' },
      ],
      sort: { key: ID2, direction: 'desc' },
      search: 'ana',
      showChange: true,
    },
  });
});

test('a minimal config gets defaults (latest period, quality dimension)', () => {
  assert.deepEqual(config(), { value: DEFAULTS });
  // An explicit null seq also means "the assignment's latest period".
  assert.deepEqual(config({ seq: null }), { value: DEFAULTS });
});

test('the config must be an object carrying a valid assignmentId', () => {
  assert.equal(parseViewConfig(null).code, 'VALIDATION_REQUIRED');
  assert.equal(parseViewConfig([]).code, 'VALIDATION_REQUIRED');
  assert.equal(parseViewConfig('x').code, 'VALIDATION_REQUIRED');
  assert.equal(config({ assignmentId: undefined }).code, 'VALIDATION_INVALID_FORMAT');
  assert.equal(config({ assignmentId: 'nope' }).code, 'VALIDATION_INVALID_FORMAT');
  assert.deepEqual(config({ assignmentId: 'nope' }).params, { field: 'assignmentId' });
});

test('seq is optional and must be a whole number from 1 (null = latest)', () => {
  assert.equal(config({ seq: 1 }).value.seq, 1);
  assert.equal(config({ seq: 0 }).code, 'VALIDATION_INVALID_RANGE');
  assert.equal(config({ seq: 1.5 }).code, 'VALIDATION_INVALID_RANGE');
  assert.equal(config({ seq: -2 }).code, 'VALIDATION_INVALID_RANGE');
  assert.equal(config({ seq: '2' }).code, 'VALIDATION_INVALID_RANGE');
});

test('dimension defaults to quality and must be quality or quantity', () => {
  assert.equal(config().value.dimension, 'quality');
  assert.equal(config({ dimension: null }).value.dimension, 'quality');
  assert.equal(config({ dimension: 'quantity' }).value.dimension, 'quantity');
  assert.equal(config({ dimension: 'bogus' }).code, 'VALIDATION_INVALID_CHOICE');
});

test('filters are checked', () => {
  const filter = (over) => config({ filters: [{ parameterId: ID2, op: 'lt', value: 5, ...over }] });
  assert.deepEqual(filter({}).value.filters, [{ parameterId: ID2, op: 'lt', value: 5 }]);
  // Presence filters carry no value, even if one was sent.
  assert.deepEqual(filter({ op: 'missing', value: 99 }).value.filters, [
    { parameterId: ID2, op: 'missing' },
  ]);
  assert.ok(filter({ op: 'bogus' }).error);
  assert.equal(filter({ op: 'bogus' }).code, 'VALIDATION_INVALID_CHOICE');
  assert.ok(filter({ value: undefined }).error);
  assert.ok(filter({ value: '5' }).error);
  assert.ok(filter({ value: 1.5 }).error);
  assert.ok(filter({ value: 1e12 }).error);
  assert.equal(filter({ value: '5' }).code, 'VALIDATION_INVALID_TYPE');
  assert.ok(filter({ parameterId: 'nope' }).error);
  assert.deepEqual(filter({ parameterId: 'nope' }).params, { field: 'parameterId' });
  assert.ok(parseViewConfig({ assignmentId: ID, filters: 'x' }).error);
  assert.ok(parseViewConfig({ assignmentId: ID, filters: [null] }).error);
  const eleven = Array.from({ length: 11 }, () => ({ parameterId: ID2, op: 'present' }));
  assert.equal(config({ filters: eleven }).code, 'VALIDATION_TOO_LONG');
  assert.deepEqual(config({ filters: eleven }).params, { max: 10 });
});

test('columns, sort, search and the change flag are checked', () => {
  assert.ok(config({ parameterIds: [ID2, ID2] }).error);
  assert.ok(config({ parameterIds: ['nope'] }).error);
  assert.ok(config({ parameterIds: 'x' }).error);
  const hundredOne = Array.from(
    { length: 101 },
    (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`
  );
  assert.ok(config({ parameterIds: hundredOne }).error);
  assert.ok(config({ sort: { key: 'bogus', direction: 'asc' } }).error);
  assert.ok(config({ sort: { key: 'name', direction: 'up' } }).error);
  assert.ok(config({ sort: 'name' }).error);
  assert.equal(config({ sort: { key: 'code', direction: 'desc' } }).error, undefined);
  assert.ok(config({ search: 'x'.repeat(101) }).error);
  assert.ok(config({ search: 5 }).error);
  assert.ok(config({ showChange: 'yes' }).error);
  assert.equal(config({ showChange: true }).value.showChange, true);
});

test('view names are trimmed and length-checked', () => {
  assert.deepEqual(parseViewName('  Needs   attention '), { value: 'Needs attention' });
  assert.ok(parseViewName('   ').error);
  assert.ok(parseViewName('x'.repeat(61)).error);
  assert.ok(parseViewName(undefined).error);
});

test('the per-user cap constant matches what the route enforces and reports', () => {
  // routes/savedViews.js rejects the Nth view with VALIDATION_TOO_LONG and
  // params { max: MAX_VIEWS_PER_USER } — pin the shared constant.
  assert.equal(MAX_VIEWS_PER_USER, 50);
});

test('saved views are personal and not written to the audit log', () => {
  assert.equal(classifyRequest('POST', '/api/saved-views', 201), null);
  assert.equal(classifyRequest('PUT', '/api/saved-views/abc', 200), null);
  assert.equal(classifyRequest('DELETE', '/api/saved-views/abc', 204), null);
});
