import { request } from './http.js';

export async function listSavedViews() {
  const data = await request('/api/saved-views');
  return data.views;
}

export async function createSavedView({ name, config }) {
  const data = await request('/api/saved-views', {
    method: 'POST',
    body: JSON.stringify({ name, config }),
  });
  return data.view;
}

export async function updateSavedView(id, fields) {
  const data = await request(`/api/saved-views/${id}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  });
  return data.view;
}

export function deleteSavedView(id) {
  return request(`/api/saved-views/${id}`, { method: 'DELETE' });
}