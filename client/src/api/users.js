import { request } from './http.js';

export async function listUsers() {
  const data = await request('/api/users');
  return data.users;
}

export function createUser(input) {
  return request('/api/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateUser(id, fields) {
  return request(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function resetUserPassword(id) {
  return request(`/api/users/${id}/reset-password`, { method: 'POST' });
}