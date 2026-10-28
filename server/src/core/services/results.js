// Results (assignment-period grid) — service layer (framework-free).
//
// On-device equivalent of routes/results.js under the schema-4 model: one
// assignment period's grid — rows are the assignment's targets (whole-group
// row first, then members; an individual assignment has exactly its member),
// columns are parameters, cells carry both dimensions plus the answered
// state, and `previous` carries the same cells from the assignment's previous
// period (seq − 1) for the change columns. No audit, no req.user (it was a
// pure GET), so the conversion is pool→getDb(), status codes→ServiceError,
// and query-string coercion done explicitly.
//
// `input` = { assignmentId, seq, dimension? }. Returns
// { assignment, period, dimension, parameters, ...buildResults(...), hasPrevious }.

import { getDb } from '../db.js';
import { ServiceError } from '../errors.js';
import { isUuid } from '../../lib/ids.js';
import {
  assignPeriods,
  listAssignmentPeriods,
  syncAssignmentPeriods,
} from '../../lib/periods.js';
import { buildResults } from '../../lib/results.js';

export async function getResults(input = {}) {
  const db = getDb();
  const { assignmentId, seq: rawSeq, dimension = 'quality' } = input;

  if (!isUuid(assignmentId)) {
    throw ServiceError.validation('assignmentId must be a valid ID.');
  }
  const seq = Number(rawSeq);
  if (!Number.isInteger(seq) || seq < 1) {
    throw ServiceError.validation('seq must be a whole number from 1.');
  }
  if (dimension !== 'quality' && dimension !== 'quantity') {
    throw ServiceError.validation('dimension must be "quality" or "quantity".');
  }

  const assignmentResult = await db.query(
    `SELECT a.id,
            a.code          AS "assignmentCode",
            a.name          AS "assignmentName",
            a.group_id      AS "groupId",
            g.name          AS "groupName",
            a.membership_id AS "assignmentMembershipId",
            t.full_name     AS "teacherName"
     FROM assignments a
     JOIN teachers t ON t.id = a.teacher_id
     LEFT JOIN student_groups g ON g.id = a.group_id
     WHERE a.id = $1`,
    [assignmentId]
  );
  const assignment = assignmentResult.rows[0];
  if (!assignment) {
    throw ServiceError.notFound('Assignment not found.');
  }

  await syncAssignmentPeriods(db, assignmentId);
  const periods = await listAssignmentPeriods(db, assignmentId);
  const period = periods.find(
    (candidate) => candidate.seq === seq && candidate.archivedAt === null
  );
  if (!period || period.sessionCount === 0) {
    throw ServiceError.validation(
      `Period ${seq} of this assignment has no sessions yet.`,
      { code: 'PERIODS_NOT_STARTED', params: { seq } }
    );
  }

  // Which sessions belong to the requested (and previous) bucket.
  const sessionsResult = await db.query(
    `SELECT id,
            seq,
            session_date::text AS "sessionDate",
            canceled_at        AS "canceledAt",
            archived_at        AS "archivedAt"
     FROM sessions
     WHERE assignment_id = $1`,
    [assignmentId]
  );
  const buckets = assignPeriods(sessionsResult.rows);
  const sessionToSeq = new Map(
    [...buckets].filter(([, bucketSeq]) => bucketSeq === seq || bucketSeq === seq - 1)
  );
  const sessionIds = [...sessionToSeq.keys()];

  const [targetsResult, parametersResult, evaluationsResult] = await Promise.all([
    db.query(
      `SELECT ms.id          AS "membershipId",
              s.id           AS "studentId",
              s.full_name    AS "fullName",
              s.student_code AS "studentCode"
       FROM assignments a
       JOIN student_group_members ms
         ON (a.group_id IS NOT NULL AND ms.group_id = a.group_id)
         OR (a.membership_id IS NOT NULL AND ms.id = a.membership_id)
       JOIN students s ON s.id = ms.student_id
       WHERE a.id = $1
         AND ms.left_on IS NULL AND s.deleted_at IS NULL
       ORDER BY lower(s.full_name)`,
      [assignmentId]
    ),
    db.query(
      `SELECT id, code, name,
              min_value AS "minValue", max_value AS "maxValue"
       FROM parameters
       WHERE archived_at IS NULL
       ORDER BY sort_order, lower(name)`
    ),
    sessionIds.length === 0
      ? Promise.resolve({ rows: [] })
      : db.query(
          `SELECT e.session_id       AS "sessionId",
                  e.membership_id    AS "membershipId",
                  e.parameter_id     AS "parameterId",
                  e.quality_value    AS "qualityValue",
                  e.quantity_value   AS "quantityValue",
                  e.quality_comment  AS "qualityComment",
                  e.quantity_comment AS "quantityComment"
           FROM evaluations e
           JOIN sessions s ON s.id = e.session_id
           WHERE e.session_id = ANY($1::uuid[]) AND e.archived_at IS NULL
           ORDER BY s.session_date ASC, s.seq ASC`,
          [sessionIds]
        ),
  ]);

  const targets = assignment.assignmentMembershipId
    ? targetsResult.rows.filter(
        (target) => target.membershipId === assignment.assignmentMembershipId
      )
    : targetsResult.rows;

  const evaluations = evaluationsResult.rows
    .map((row) => ({
      ...row,
      periodSeq: sessionToSeq.get(row.sessionId) ?? null,
    }))
    .filter((row) => row.periodSeq !== null);

  const built = buildResults({
    seq,
    period,
    assignment,
    parameters: parametersResult.rows,
    targets,
    groupName: assignment.groupName,
    evaluations,
  });

  return {
    assignment: {
      id: assignment.id,
      code: assignment.assignmentCode,
      name: assignment.assignmentName,
      teacherName: assignment.teacherName,
    },
    period: {
      id: period.id,
      seq: period.seq,
      startDate: period.startDate,
      endDate: period.endDate,
    },
    dimension,
    parameters: parametersResult.rows,
    ...built,
    hasPrevious: periods.some(
      (candidate) => candidate.seq === seq - 1 && candidate.sessionCount > 0
    ),
  };
}
