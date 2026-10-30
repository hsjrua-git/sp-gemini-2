import { request } from './http.js';

// Cafe inventory. Reading needs `cafe.view`; recording a correction needs
// `cafe.inventory`. Money is whole-number Toman (bigint on the server arrives
// as a string over JSON); quantities carry up to three decimals.

// { stock, movements, truncated } — current stock per product plus the last
// 100 movements across all products.
export function getCafeInventory() {
  return request('/api/cafe/inventory');
}

// One product's stock card: { product, qty, movements } where each movement
// carries a `runningQty`, ordered oldest → newest (the last line's running
// qty equals the current stock).
export function getProductStockCard(productId) {
  return request(`/api/cafe/inventory/${encodeURIComponent(productId)}`);
}

// recordInventory resolves to { recorded } (the number of movements written).
// Waste quantities are POSITIVE (the amount thrown away — stored negative and
// valued at the average cost); adjustment quantities are SIGNED (found extra
// = +, missing = −, valued at 0).
export function recordInventory({ kind, items, note }) {
  const body = { kind, items };
  if (note !== undefined) body.note = note;
  return request('/api/cafe/inventory', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
