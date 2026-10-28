import { request } from './http.js';

export async function listParameters() {
  const data = await request('/api/parameters');
  return data.parameters;
}

export function createParameter(input) {
  return request('/api/parameters', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateParameter(id, fields) {
  return request(`/api/parameters/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}
