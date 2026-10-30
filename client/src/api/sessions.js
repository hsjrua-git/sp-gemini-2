import { request } from './http.js';

export async function listSessions({
  from = null,
  to = null,
  teacherId = null,
  assignmentId = null,
  includeCanceled = false,
  includeArchived = false,
} = {}) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (teacherId) params.set('teacherId', teacherId);
  if (assignmentId) params.set('assignmentId', assignmentId);
  if (includeCanceled) params.set('includeCanceled', '1');
  if (includeArchived) params.set('includeArchived', '1');
  const query = params.size > 0 ? `?${params}` : '';
  const data = await request(`/api/sessions${query}`);
  return { sessions: data.sessions, truncated: data.truncated };
}

export function generateSessions(body) {
  return request('/api/sessions/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateSession(id, fields) {
  return request(`/api/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}
