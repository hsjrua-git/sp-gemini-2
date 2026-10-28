import { request } from './http.js';

// Cafe range reports. Read-only, needs `cafe.view`. `from` and `to` are ISO
// dates (YYYY-MM-DD) and both ends are inclusive; money comes back as
// whole-number Toman.
export function getCafeReport({ from, to }) {
  const query = new URLSearchParams({ from, to });
  return request(`/api/cafe/reports?${query.toString()}`);
}
