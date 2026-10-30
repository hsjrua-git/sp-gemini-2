import { request } from './http.js';

export async function listTeachers({ search = '', includeArchived = false } = {}) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (includeArchived) params.set('includeArchived', '1');
  const query = params.size > 0 ? `?${params}` : '';
  const data = await request(`/api/teachers${query}`);
  return data.teachers;
}

export function createTeacher({ fullName, birthDate, nationalId }) {
  return request('/api/teachers', {
    method: 'POST',
    body: JSON.stringify({ fullName, birthDate, nationalId }),
  });
}

export function updateTeacher(id, fields) {
  return request(`/api/teachers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function archiveTeacher(id) {
  return request(`/api/teachers/${id}`, { method: 'DELETE' });
}
