import { request } from './http.js';

export function getScopedResults(periodIds) {
  return request(`/api/results/scope?${new URLSearchParams({ periodIds: periodIds.join(',') })}`);
}

// One assignment period's grid (rows = the assignment's targets, columns =
// parameters, cells carry both dimensions). `seq` is the period's number
// within the assignment; `dimension` picks the value column (quality|quantity).
export function getResults({ assignmentId, seq, dimension = 'quality' }) {
  const params = new URLSearchParams({
    assignmentId,
    seq: String(seq),
    dimension,
  });
  return request(`/api/results?${params}`);
}
