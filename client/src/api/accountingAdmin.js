import { request } from './http.js';

// The accounting admin surface: chart of accounts, the cafe→journal
// mappings, fiscal periods (with close/reopen and the automatic closing
// entry), and the once-ever opening entry.

export async function listAccounts({ includeInactive = false } = {}) {
  const suffix = includeInactive ? '?includeInactive=1' : '';
  const data = await request(`/api/accounting/accounts${suffix}`);
  return data.accounts;
}

export function createAccount({ code, name, type, parentId }) {
  const body = { code, name, type };
  if (parentId) body.parentId = parentId;
  return request('/api/accounting/accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateAccount(id, fields) {
  return request(`/api/accounting/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function deactivateAccount(id) {
  return request(`/api/accounting/accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function listMappings() {
  const data = await request('/api/accounting/mappings');
  return data.mappings;
}

export function updateMapping(event, fields) {
  return request(`/api/accounting/mappings/${encodeURIComponent(event)}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export async function listPeriods() {
  const data = await request('/api/accounting/periods');
  return data.periods;
}

export function createPeriod({ name, startDate, endDate }) {
  return request('/api/accounting/periods', {
    method: 'POST',
    body: JSON.stringify({ name, startDate, endDate }),
  });
}

export function updatePeriod(id, fields) {
  return request(`/api/accounting/periods/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function closePeriod(id) {
  return request(`/api/accounting/periods/${encodeURIComponent(id)}/close`, {
    method: 'POST',
  });
}

export function reopenPeriod(id) {
  return request(`/api/accounting/periods/${encodeURIComponent(id)}/reopen`, {
    method: 'POST',
  });
}

export async function getOpening() {
  const data = await request('/api/accounting/periods/opening');
  return data.opening;
}

export function createOpening({ date }) {
  return request('/api/accounting/periods/opening', {
    method: 'POST',
    body: JSON.stringify({ date }),
  });
}
