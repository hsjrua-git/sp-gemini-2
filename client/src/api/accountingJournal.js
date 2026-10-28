import { request } from './http.js';

// The accounting journal. Reading needs `accounting.view`, drafting
// `accounting.enter`, posting/voiding `accounting.post`. Money is bigint
// Toman (arrives as strings over JSON); every entry must balance.

export async function listJournalEntries({
  from,
  to,
  status,
  accountId,
  sourceType,
} = {}) {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  if (status) query.set('status', status);
  if (accountId) query.set('accountId', accountId);
  if (sourceType) query.set('sourceType', sourceType);
  const suffix = query.toString() !== '' ? `?${query.toString()}` : '';
  return request(`/api/accounting/journal${suffix}`);
}

export function createJournalEntry({ entryDate, memo, lines }) {
  const body = { entryDate, lines };
  if (memo) body.memo = memo;
  return request('/api/accounting/journal', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function postEntry(id) {
  return request(`/api/accounting/journal/${encodeURIComponent(id)}/post`, {
    method: 'POST',
  });
}

export function voidEntry(id) {
  return request(`/api/accounting/journal/${encodeURIComponent(id)}/void`, {
    method: 'POST',
  });
}

// The chart of accounts for line pickers (the admin pages have their own
// richer module; this is the read the journal needs).
export async function listAccounts({ includeInactive = false } = {}) {
  const suffix = includeInactive ? '?includeInactive=1' : '';
  const data = await request(`/api/accounting/accounts${suffix}`);
  return data.accounts;
}
