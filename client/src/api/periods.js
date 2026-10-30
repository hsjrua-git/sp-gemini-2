import { request } from './http.js';

// The period calendar of one assignment — there is no school-wide period
// anymore. A session appears only after its first answer; membership is
// persisted and maintained by the server. Callers without scores.view get the
// periods without answered-cell counts.
export async function getPeriods(assignmentId) {
  const data = await request(`/api/periods${assignmentId ? `?assignmentId=${assignmentId}` : ''}`);
  return data.periods;
}
