import { request } from './http.js';

export function listAssignmentTargets() { return request('/api/assignments/targets'); }
export function createAssignments(input) { return request('/api/assignments/bulk', { method: 'POST', body: JSON.stringify(input) }); }

export async function listIntervals({ includeArchived = false } = {}) {
  const query = includeArchived ? '?includeArchived=1' : '';
  const data = await request(`/api/intervals${query}`);
  return data.intervals;
}

export function createInterval({ name, everyDays, everyMonths, sortOrder }) {
  const body = { name };
  if (everyMonths !== undefined) body.everyMonths = everyMonths;
  else body.everyDays = everyDays;
  if (sortOrder !== undefined) body.sortOrder = sortOrder;
  return request('/api/intervals', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateInterval(id, fields) {
  return request(`/api/intervals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function archiveInterval(id) {
  return request(`/api/intervals/${id}`, { method: 'DELETE' });
}

export async function listAssignments({
  teacherId = null,
  groupId = null,
  includeArchived = false,
} = {}) {
  const params = new URLSearchParams();
  if (teacherId) params.set('teacherId', teacherId);
  if (groupId) params.set('groupId', groupId);
  if (includeArchived) params.set('includeArchived', '1');
  const query = params.size > 0 ? `?${params}` : '';
  const data = await request(`/api/assignments${query}`);
  return data.assignments;
}

export async function listStudentMemberships(studentId) {
  const data = await request(`/api/assignments/memberships?studentId=${studentId}`);
  return data.memberships;
}

export function createAssignment(input) {
  return request('/api/assignments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateAssignment(id, fields) {
  return request(`/api/assignments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function archiveAssignment(id) {
  return request(`/api/assignments/${id}`, { method: 'DELETE' });
}
