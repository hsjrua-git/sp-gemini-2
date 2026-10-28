import { request } from './http.js';

export async function listFieldDefinitions({ includeArchived = false } = {}) {
  const query = includeArchived ? '?includeArchived=1' : '';
  const data = await request(`/api/field-definitions${query}`);
  return data.fields;
}

export function createFieldDefinition(input) {
  return request('/api/field-definitions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateFieldDefinition(id, fields) {
  return request(`/api/field-definitions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function archiveFieldDefinition(id) {
  return request(`/api/field-definitions/${id}`, { method: 'DELETE' });
}
