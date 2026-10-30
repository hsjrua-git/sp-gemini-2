import { request } from './http.js';

export async function listSessionTasks(sessionId) {
  const data = await request(`/api/tasks?sessionId=${sessionId}`);
  return data.tasks;
}

export function createTask(body) {
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

export function assignTaskTemplate(body) {
  return request('/api/tasks/from-template', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function listTaskTemplates({ includeArchived = false } = {}) {
  const query = includeArchived ? '?includeArchived=1' : '';
  const data = await request(`/api/task-templates${query}`);
  return data.templates;
}

export function createTaskTemplate(body) {
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

export function updateTaskProgress(id, fields) {
  return request(`/api/tasks/${id}/progress`, { method: 'PATCH', body: JSON.stringify(fields) });
}

export function listTaskTargets(sessionIds) {
  return request(`/api/tasks/targets?${new URLSearchParams({ sessionIds: sessionIds.join(',') })}`);
}
