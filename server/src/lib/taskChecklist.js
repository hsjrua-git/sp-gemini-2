import { randomUUID } from 'node:crypto';
import { isUuid } from './ids.js';

const invalid = () => ({ error: 'Invalid checklist or progress update.', code: 'TASK_CHECKLIST_INVALID' });
export function parseChecklist(raw) {
  if (!Array.isArray(raw) || raw.length > 50) return invalid();
  const value = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some(key => !['id', 'label'].includes(key)) ||
        typeof item.label !== 'string' || !item.label.trim() || item.label.trim().length > 200 ||
        (item.id !== undefined && !isUuid(item.id))) return invalid();
    value.push({ id: item.id ?? randomUUID(), label: item.label.trim() });
  }
  if (new Set(value.map(item => item.id.toLowerCase())).size !== value.length) return invalid();
  return { value };
}

export function checklistSnapshot(definition = []) {
  return definition.map(({ id, label }) => ({ id, label, done: false, doneAt: null, note: null }));
}

// Apply only requested fields to the latest locked row; concurrent updates to
// different checklist items cannot overwrite one another.
export function taskProgress(task, body, now = new Date().toISOString()) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !Object.keys(body).length || Object.keys(body).some(key => !['itemId', 'done', 'note'].includes(key)) ||
      (!('done' in body) && !('note' in body)) ||
      ('done' in body && typeof body.done !== 'boolean') ||
      ('note' in body && body.note !== null && (typeof body.note !== 'string' || body.note.length > 2000))) return invalid();
  const checklist = (task.checklist ?? []).map(item => ({ ...item }));
  const note = body.note?.trim() || null;
  if ('itemId' in body) {
    const item = checklist.find(item => item.id === body.itemId);
    if (!item) return invalid();
    if ('done' in body) { item.done = body.done; item.doneAt = body.done ? item.doneAt ?? now : null; }
    if ('note' in body) item.note = note;
  } else if ('done' in body) {
    for (const item of checklist) { item.done = body.done; item.doneAt = body.done ? item.doneAt ?? now : null; }
  }
  const done = checklist.length ? checklist.every(item => item.done) : body.done ?? task.done;
  return { value: { checklist, done, doneAt: done ? task.doneAt ?? now : null,
    note: !('itemId' in body) && 'note' in body ? note : task.note ?? null } };
}
