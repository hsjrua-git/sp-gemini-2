import { request } from './http.js';

// Fetch the export cube: every requested student × parameter × period slice in
// one request, cells already student-shaped (whole-group rows expanded per
// member with the member's own row shadowing them per session). `scope` is
// resolved by the page from its config:
//   { assignmentId?: string|null, periods?: number[], from?: string, to?: string,
//     groupId?: string|null, studentIds?: string[], parameterIds?: string[] }
export async function fetchCube(scope) {
  const body = {};
  if (scope.periodIds) body.periodIds = scope.periodIds;
  if (scope.assignmentId) body.assignmentId = scope.assignmentId;
  if (scope.periods?.length) body.periods = scope.periods;
  if (scope.from) body.from = scope.from;
  if (scope.to) body.to = scope.to;
  if (scope.groupId) body.groupId = scope.groupId;
  if (scope.studentIds?.length) body.studentIds = scope.studentIds;
  if (scope.parameterIds?.length) body.parameterIds = scope.parameterIds;
  return request('/api/export/cube', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
