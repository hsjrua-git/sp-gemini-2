import { request } from './http.js';

export async function fetchMe() {
  try {
    const data = await request('/api/auth/me');
    return data.user;
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}

export async function login({ username, password }) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return data.user;
}

export function logout() {
  return request('/api/auth/logout', { method: 'POST' });
}

export async function changePassword({ currentPassword, newPassword }) {
  const data = await request('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return data.user;
}