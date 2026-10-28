import { request } from './http.js';

// History and grid reads. Filters combine; the server requires at least one,
// so this can never become a full-table dump.
export async function listEvaluations({
  sessionId = null,
  assignmentId = null,
  studentId = null,
  parameterId = null,
} = {}) {
  const params = new URLSearchParams();
  if (sessionId) params.set('sessionId', sessionId);
  if (assignmentId) params.set('assignmentId', assignmentId);
  if (studentId) params.set('studentId', studentId);
  if (parameterId) params.set('parameterId', parameterId);
  const data = await request(`/api/evaluations?${params}`);
  return data.evaluations;
}

// Save one session's cells. Each entry carries the FULL cell state (the
// server overwrites absent comments with null): membershipId null is the
// whole-group row, `selected: false` removes the row entirely (the row is
// the expectation), and both values may be null = selected but unanswered.
export function saveEvaluations({
  sessionId,
  entries,
  overrideReason,
  dryRun,
  source,
}) {
  return request('/api/evaluations/bulk', {
    method: 'PUT',
    body: JSON.stringify({
      sessionId,
      entries,
      ...(overrideReason ? { overrideReason } : {}),
      ...(dryRun ? { dryRun: true } : {}),
      ...(source ? { source } : {}),
    }),
  });
}

export async function listStudentEvaluations(studentId) {
  const data = await request(`/api/evaluations?studentId=${studentId}`);
  return data.evaluations;
}
