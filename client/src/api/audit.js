import { request } from './http.js';

export function listAudit({ category = '', actor = '', page = 1 } = {}) {
  const params = new URLSearchParams({ page: String(page) });
  if (category) params.set('category', category);
  if (actor) params.set('actor', actor);
  return request(`/api/audit?${params}`);
}

// The Export Center needs the whole audit trail, but the endpoint is paged
// (25/entry). Walk the pages up to a bound so a huge log can't stall the export,
// reporting whether more entries were left behind. `category`/`actor` narrow it
// exactly like the Audit page.
export async function fetchAuditTrail({ category = '', actor = '', maxPages = 20 } = {}) {
  const entries = [];
  let total = 0;
  let pages = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await listAudit({ category, actor, page });
    total = data.total;
    pages = page;
    entries.push(...data.entries);
    if (entries.length >= data.total || data.entries.length === 0) break;
  }
  return { entries, total, truncated: entries.length < total, pagesFetched: pages };
}
