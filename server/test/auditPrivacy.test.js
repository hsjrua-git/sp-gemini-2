import test from 'node:test';
import assert from 'node:assert/strict';
import { redactRestrictedFields } from '../src/lib/auditPrivacy.js';

test('audit output recursively strips restricted custom field values', () => {
  const input = {
    request: { extra: { public: 'bus', secret: '09120000000' } },
    result: {
      student: { extra: { public: 'walk', secret: 'private' } },
      changes: [{ before: { extra: { secret: 'old' } } }],
    },
  };
  assert.deepEqual(redactRestrictedFields(input, new Set(['secret'])), {
    request: { extra: { public: 'bus' } },
    result: {
      student: { extra: { public: 'walk' } },
      changes: [{ before: { extra: {} } }],
    },
  });
  assert.deepEqual(input.request.extra, { public: 'bus', secret: '09120000000' });
});
