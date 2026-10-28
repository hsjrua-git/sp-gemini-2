import { request } from './http.js';

export async function listSessionTasks(sessionId) {
  const data = await request(`/api/tasks?sessionId=${sessionId}`);
  return data.tasks;
}

export function createTask({ sessionId, title, description, sortOrder }) {
  const body = { sessionId, title };
  if (description !== undefined) body.description = description;
  if (sortOrder !== undefined) body.sortOrder = sortOrder;
  return request('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateTask(id, fields) {
  return request(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function deleteTask(id) {
  return request(`/api/tasks/${id}`, { method: 'DELETE' });
}

export function assignTaskTemplate({ templateId, sessionIds }) {
  return request('/api/tasks/from-template', {
    method: 'POST',
    body: JSON.stringify({ templateId, sessionIds }),
  });
}

export async function listTaskTemplates({ includeArchived = false } = {}) {
  const query = includeArchived ? '?includeArchived=1' : '';
  const data = await request(`/api/task-templates${query}`);
  return data.templates;
}

export function createTaskTemplate({ title, description, sortOrder }) {
  const body = { title };
  if (description !== undefined) body.description = description;
  if (sortOrder !== undefined) body.sortOrder = sortOrder;
  return request('/api/task-templates', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateTaskTemplate(id, fields) {
  return request(`/api/task-templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function archiveTaskTemplate(id) {
  return request(`/api/task-templates/${id}`, { method: 'DELETE' });
}
