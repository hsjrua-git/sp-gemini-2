import { request } from './http.js';

export function listStudents({
  search = '',
  page = 1,
  pageSize = 25,
  sort = 'newest',
  groupId = null,
} = {}) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sort,
  });
  if (search) params.set('search', search);
  if (groupId) params.set('groupId', groupId);
  return request(`/api/students?${params}`);
}

export function createStudent(fullName, extra) {
  const body = extra ? { fullName, extra } : { fullName };
  return request('/api/students', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function renameStudent(id, fullName) {
  return request(`/api/students/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fullName }),
  });
}

// Update arbitrary student fields (full name and/or custom fields in `extra`).
export function updateStudent(id, fields) {
  return request(`/api/students/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function deleteStudent(id) {
  return request(`/api/students/${id}`, { method: 'DELETE' });
}

export function getStudent(id) {
  return request(`/api/students/${id}`);
}
export async function fetchAllStudents() {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const data = await listStudents({ page, pageSize: 100, sort: 'name' });
    all.push(...data.students);
    if (all.length >= data.total || data.students.length === 0) break;
  }
  return all;
}

export function importStudents({ rows, allowDuplicateNames, dryRun }) {
  return request('/api/students/import', {
    method: 'POST',
    body: JSON.stringify({ rows, allowDuplicateNames, dryRun }),
  });
}