import { request } from './http.js';

// Cafe products. Reading needs `cafe.view`; every write needs `cafe.manage`
// (reactivation is a PATCH with isActive, not a dedicated endpoint).

export async function listCafeProducts({ includeInactive = false } = {}) {
  const query = includeInactive ? '?includeInactive=1' : '';
  const data = await request(`/api/cafe/products${query}`);
  return data.products;
}

export function createCafeProduct({ name, price, sortOrder, isActive }) {
  const body = { name, price };
  if (sortOrder !== undefined) body.sortOrder = sortOrder;
  if (isActive !== undefined) body.isActive = isActive;
  return request('/api/cafe/products', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateCafeProduct(id, fields) {
  return request(`/api/cafe/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function deactivateCafeProduct(id) {
  return request(`/api/cafe/products/${id}`, { method: 'DELETE' });
}

// Cafe suppliers. Everything here needs `cafe.supplies` (which presupposes
// `cafe.view`), so the whole section is hidden from anyone who lacks it.

export async function listCafeSuppliers({ includeInactive = false } = {}) {
  const query = includeInactive ? '?includeInactive=1' : '';
  const data = await request(`/api/cafe/suppliers${query}`);
  return data.suppliers;
}

export function createCafeSupplier({ name, phone, note }) {
  const body = { name };
  if (phone !== undefined) body.phone = phone;
  if (note !== undefined) body.note = note;
  return request('/api/cafe/suppliers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateCafeSupplier(id, fields) {
  return request(`/api/cafe/suppliers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function deactivateCafeSupplier(id) {
  return request(`/api/cafe/suppliers/${id}`, { method: 'DELETE' });
}
