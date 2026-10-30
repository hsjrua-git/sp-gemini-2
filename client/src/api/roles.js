import { request } from './http.js';

export async function listRoles() {
  const data = await request('/api/roles');
  return data.roles;
}

export async function fetchPermissionCatalog() {
  return request('/api/roles/catalog');
}

export function createRole(input) {
  return request('/api/roles', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateRole(id, fields) {
  return request(`/api/roles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function deleteRole(id) {
  return request(`/api/roles/${id}`, { method: 'DELETE' });
}
