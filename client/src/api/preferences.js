import { request } from './http.js';

export async function getPreferences() {
  const data = await request('/api/preferences');
  return data.preferences;
}

export async function savePreferences(changes) {
  const data = await request('/api/preferences', {
    method: 'PUT',
    body: JSON.stringify(changes),
  });
  return data.preferences;
}

export async function resetPreferences() {
  const data = await request('/api/preferences', { method: 'DELETE' });
  return data.preferences;
}