import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionPlan } from '../src/lib/sessionPlan.js';

const id = '11111111-1111-4111-8111-111111111111';
test('session plans require an explicit target and valid bounded scope', () => {
  for (const body of [null, [], {}, { assignmentIds: [id], mode: 'periods', count: 51 },
    { assignmentIds: [id], mode: 'date', until: '2026-02-30' },
    { assignmentIds: [id], mode: 'date', from: '2026-11-01', until: '2026-10-30' },
    { assignmentIds: [id], mode: 'sessions', count: 1, from: 0 }]) assert.ok(parseSessionPlan(body).error);
  assert.equal(parseSessionPlan({ assignmentIds: [id], mode: 'periods', count: 3, from: '2027-01-01', until: '2026-01-01' }).value.count, 12);
  assert.equal(parseSessionPlan({ assignmentId: id, until: '2026-12-01' }).value.count, 1001);
});
