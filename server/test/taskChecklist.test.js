import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChecklist, checklistSnapshot, taskProgress } from '../src/lib/taskChecklist.js';

test('definitions reject progress, duplicate ids, oversized and malformed lists', () => {
  const { value } = parseChecklist([{ label: ' First ' }, { label: 'Second' }]);
  assert.equal(value[0].label, 'First');
  for (const raw of [null, {}, [{ label: '' }], [{ label: 'A', done: true }], [value[0], value[0]], Array.from({ length: 51 }, () => ({ label: 'A' }))]) assert.ok(parseChecklist(raw).error);
});

test('assigned snapshots retain independent progress and server completion times', () => {
  const definition = parseChecklist([{ label: 'First' }, { label: 'Second' }]).value;
  const first = { checklist: checklistSnapshot(definition), done: false };
  const other = { checklist: checklistSnapshot(definition), done: false };
  const at = '2026-10-30T10:00:00.000Z';
  const partial = taskProgress(first, { itemId: definition[0].id, done: true, note: '  Practised  ' }, at).value;
  assert.equal(partial.done, false);
  assert.equal(partial.checklist[0].doneAt, at);
  assert.equal(partial.checklist[0].note, 'Practised');
  const complete = taskProgress(partial, { itemId: definition[1].id, done: true }, at).value;
  assert.equal(complete.done, true);
  assert.equal(complete.doneAt, at);
  assert.equal(taskProgress(complete, { done: true }, '2026-10-31T10:00:00.000Z').value.doneAt, at);
  assert.equal(taskProgress(complete, { itemId: definition[0].id, done: false }).value.doneAt, null);
  assert.equal(other.checklist[0].done, false);
  assert.equal(first.checklist[0].done, false);
  assert.equal(definition[0].done, undefined);
  for (const body of [{ itemId: 'missing', done: true }, { doneAt: at }, { note: 3 }, { note: 'a'.repeat(2001) }, { done: 'true' }]) assert.ok(taskProgress(first, body).error);
});
