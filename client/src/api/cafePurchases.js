import { request } from './http.js';

// Cafe purchases (supplies). Both reading and writing need `cafe.supplies`.
// A purchase is immutable once recorded — there is no edit/delete here.

export async function listCafePurchases({
  from = null,
  to = null,
  supplierId = null,
} = {}) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (supplierId) params.set('supplierId', supplierId);
  const query = params.size > 0 ? `?${params}` : '';
  const data = await request(`/api/cafe/purchases${query}`);
  return { purchases: data.purchases, truncated: data.truncated };
}

export function recordPurchase({ supplierId, note, purchasedAt, items }) {
  const body = { supplierId, items };
  if (note !== undefined) body.note = note;
  // An empty purchasedAt means "today" — sending '' would fail the server's
  // date check, so leave it out and let the server default to current_date.
  if (purchasedAt) body.purchasedAt = purchasedAt;
  return request('/api/cafe/purchases', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
