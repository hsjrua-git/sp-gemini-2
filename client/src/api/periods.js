import { request } from './http.js';

// The period calendar of one assignment — there is no school-wide period
// anymore. Periods are materialized server-side on demand, so a fresh
// assignment lists its periods immediately. Callers without scores.view get
// the periods without the answered-cell counts (stripped by the server).
export async function getPeriods(assignmentId) {
  const data = await request(`/api/periods?assignmentId=${assignmentId}`);
  return data.periods;
}
