// Assignment period calendar — service layer (framework-free).
//
// PGlite test mirror of routes/periods.js under the schema-4 model: there is
// no school-wide period or anchor date anymore — every assignment has its own
// calendar (four answered active sessions per period), maintained by database
// triggers. Plain args in, plain data out,
// ServiceError instead of status codes, getDb() for the pool. No audit, no
// req.user in the route, so the conversion is purely pool -> getDb().
//
// The single-admin collapse the route made does not apply here: the answered
// count is score-derived and stripped server-side for callers without
// scores.view — the test admin always has it, so nothing to collapse.

import { getDb } from '../db.js';
import { ServiceError } from '../errors.js';
import { isUuid } from '../../lib/ids.js';
import {
  listAssignmentPeriods,
} from '../../lib/periods.js';

// The period calendar of one assignment, each period with its session count
// and answered-cell count. Generated sessions do not appear until answered.
export async function listPeriods(assignmentId) {
  if (!isUuid(assignmentId)) {
    throw ServiceError.validation('assignmentId must be a valid ID.');
  }
  const db = getDb();

  const assignment = await db.query('SELECT id FROM assignments WHERE id = $1', [
    assignmentId,
  ]);
  if (assignment.rowCount === 0) {
    throw ServiceError.notFound('Assignment not found.');
  }

  return { periods: await listAssignmentPeriods(db, assignmentId) };
}
