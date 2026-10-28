import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRequest } from '../src/lib/auditRules.js';
import {
  DEFAULT_PREFERENCES,
  mergePreferences,
  parsePreferencesUpdate,
} from '../src/lib/preferences.js';

const ID1 = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const ID2 = '11111111-1111-4111-8111-111111111111';

test('missing or broken stored settings fall back to defaults', () => {
  assert.deepEqual(mergePreferences({}), DEFAULT_PREFERENCES);
  assert.deepEqual(mergePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(
    mergePreferences({ theme: 'blue', studentsPageSize: 7, extra: 1 }),
    DEFAULT_PREFERENCES
  );
});

test('valid stored settings are kept and the rest use defaults', () => {
  const merged = mergePreferences({
    theme: 'dark',
    studentsSort: 'name',
    hiddenParameterIds: [ID1],
  });
  assert.equal(merged.theme, 'dark');
  assert.equal(merged.studentsSort, 'name');
  assert.deepEqual(merged.hiddenParameterIds, [ID1]);
  assert.equal(merged.studentsPageSize, 25);
});

test('the defaults object is never shared or changed', () => {
  const merged = mergePreferences({});
  merged.hiddenParameterIds.push(ID1);
  assert.deepEqual(DEFAULT_PREFERENCES.hiddenParameterIds, []);
  assert.deepEqual(mergePreferences({}).hiddenParameterIds, []);
});

test('updates accept known settings with valid values', () => {
  assert.deepEqual(parsePreferencesUpdate({ theme: 'light' }), {
    values: { theme: 'light' },
  });
  assert.deepEqual(
    parsePreferencesUpdate({
      studentsPageSize: 50,
      studentsShowCode: false,
      studentDefaultTab: 'parameter',
    }),
    {
      values: {
        studentsPageSize: 50,
        studentsShowCode: false,
        studentDefaultTab: 'parameter',
      },
    }
  );
});

test('updates with unknown settings or bad values are refused', () => {
  assert.ok(parsePreferencesUpdate({ theme: 'blue' }).error);
  assert.ok(parsePreferencesUpdate({ studentsPageSize: 30 }).error);
  assert.ok(parsePreferencesUpdate({ studentsPageSize: '25' }).error);
  assert.ok(parsePreferencesUpdate({ studentsShowCode: 'yes' }).error);
  assert.ok(parsePreferencesUpdate({ nonsense: 1 }).error);
  assert.ok(parsePreferencesUpdate({}).error);
  assert.ok(parsePreferencesUpdate(null).error);
  assert.ok(parsePreferencesUpdate([]).error);
  assert.ok(parsePreferencesUpdate('theme').error);
});

test('the palette must be one of the known presets', () => {
  assert.deepEqual(parsePreferencesUpdate({ palette: 'midnight' }), {
    values: { palette: 'midnight' },
  });
  assert.deepEqual(parsePreferencesUpdate({ palette: 'aurora' }), {
    values: { palette: 'aurora' },
  });
  assert.deepEqual(parsePreferencesUpdate({ palette: 'gradebook' }), {
    values: { palette: 'gradebook' },
  });
  assert.ok(parsePreferencesUpdate({ palette: 'indigo' }).error);
  assert.ok(parsePreferencesUpdate({ palette: 5 }).error);
  assert.equal(mergePreferences({}).palette, 'aurora');
});

test('hidden parameter lists are validated', () => {
  assert.deepEqual(parsePreferencesUpdate({ hiddenParameterIds: [ID1, ID2] }), {
    values: { hiddenParameterIds: [ID1, ID2] },
  });
  assert.deepEqual(parsePreferencesUpdate({ hiddenParameterIds: [] }), {
    values: { hiddenParameterIds: [] },
  });
  assert.ok(parsePreferencesUpdate({ hiddenParameterIds: ['nope'] }).error);
  assert.ok(parsePreferencesUpdate({ hiddenParameterIds: [ID1, ID1] }).error);
  assert.ok(parsePreferencesUpdate({ hiddenParameterIds: 'x' }).error);

  const tooMany = Array.from(
    { length: 201 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
  );
  assert.ok(parsePreferencesUpdate({ hiddenParameterIds: tooMany }).error);
});

test('saving personal settings is not written to the audit log', () => {
  assert.equal(classifyRequest('PUT', '/api/preferences', 200), null);
  assert.equal(classifyRequest('DELETE', '/api/preferences', 200), null);
});
test('the spreadsheet separator is a comma or a semicolon', () => {
  assert.deepEqual(parsePreferencesUpdate({ csvDelimiter: ';' }), {
    values: { csvDelimiter: ';' },
  });
  assert.ok(parsePreferencesUpdate({ csvDelimiter: '|' }).error);
  assert.ok(parsePreferencesUpdate({ csvDelimiter: 5 }).error);
  assert.equal(mergePreferences({}).csvDelimiter, ',');
});