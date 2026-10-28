import { request } from './http.js';

export async function listGroups({ includeArchived = false } = {}) {
  const query = includeArchived ? '?includeArchived=1' : '';
  const data = await request(`/api/groups${query}`);
  return data.groups;
}

export async function listStudentGroups(studentId) {
  const data = await request(`/api/groups?studentId=${studentId}`);
  return data.groups;
}

export function createGroup(input) {
  return request('/api/groups', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateGroup(id, fields) {
  return request(`/api/groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function archiveGroup(id) {
  return request(`/api/groups/${id}`, { method: 'DELETE' });
}

export async function listGroupMembers(id) {
  const data = await request(`/api/groups/${id}/members`);
  return data.students;
}

export function updateGroupMembers(id, { add = [], remove = [] }) {
  return request(`/api/groups/${id}/members`, {
    method: 'PUT',
    body: JSON.stringify({ add, remove }),
  });
}
