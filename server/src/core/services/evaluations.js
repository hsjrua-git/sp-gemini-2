// Evaluations (session cells) — service layer (framework-free).
//
// On-device equivalent of routes/evaluations.js under the schema-4 model: an
// evaluation ROW is one session cell — a session × parameter × target (a
// member, or the whole group via membership NULL) — carrying two
// independently-nullable ranged integers (quality, quantity), each with its
// own comment. The read query filters by sessionId/assignmentId/studentId/
// parameterId (at least one required); the bulk save treats `selected` as the
// cell's existence (a stored row IS the expectation; selected:false deletes)
// with the dry-run preview, lock/override handling, and audit trail. Plain
// args in, plain data out, ServiceError instead of status codes, getDb() for
// the pool, getLocalActor() for the audit row.
//
// Single-user collapse of the two permission checks the route made:
//   * userCan(req, 'scores.view')     -> always true: the dry-run preview is
//     never redacted (no blind-entry role on-device).
//   * userCan(req, 'scores.override') -> always true: the admin may always
//     edit a locked cell. The lock itself is KEPT as a deliberate guardrail —
//     a locked change still needs a written override reason, which is audited.
//
// Rich failures (invalid entries, a missing override reason) carry their
// structured payload on ServiceError.details ({ problems, code }) so the client
// adapter can render the same UI the route's JSON body drove.

import { getDb } from '../db.js';
import { ServiceError } from '../errors.js';
import { getLocalActor } from '../context.js';
import { recordAudit } from '../../lib/audit.js';
import { isUuid } from '../../lib/ids.js';
import {
  cellKey,
  findLockedChanges,
  locksAtFor,
  parseOverrideReason,
} from '../../lib/locks.js';
import { todayIso } from '../../lib/periods.js';
import {
  findProblems,
  normalizeComment,
  validateShape,
} from '../../lib/evaluationCheck.js';
import { previewCells, previewCounts } from '../../lib/scorePreview.js';

const EVALUATION_SELECT = `
  SELECT e.id,
         e.session_id                    AS "sessionId",
         s.assignment_id                 AS "assignmentId",
         s.code                          AS "sessionCode",
         s.session_date::text            AS "sessionDate",
         e.parameter_id                  AS "parameterId",
         e.membership_id                 AS "membershipId",
         ms.student_id::text             AS "studentId",
         e.quality_value                 AS "qualityValue",
         e.quantity_value                AS "quantityValue",
         e.quality_comment               AS "qualityComment",
         e.quantity_comment              AS "quantityComment",
         e.locks_at                      AS "locksAt",
         (e.locks_at <= now())           AS "isLocked",
         e.updated_at                    AS "updatedAt"
  FROM evaluations e
  JOIN sessions s ON s.id = e.session_id
  LEFT JOIN student_group_members ms ON ms.id = e.membership_id
`;

// The assignment's valid evaluation targets: for a group assignment every
// open membership of the group, for an individual assignment exactly its own
// member. Maps membershipId → student info.
async function loadTargets(db, assignment) {
  if (assignment.assignmentMembershipId) {
    const result = await db.query(
      `SELECT ms.id            AS "membershipId",
              s.id             AS "studentId",
              s.full_name      AS "fullName",
              s.student_code   AS "studentCode"
       FROM student_group_members ms
       JOIN students s ON s.id = ms.student_id
       WHERE ms.id = $1 AND s.deleted_at IS NULL`,
      [assignment.assignmentMembershipId]
    );
    return new Map(result.rows.map((row) => [row.membershipId, row]));
  }
  const result = await db.query(
    `SELECT ms.id         AS "membershipId",
            s.id          AS "studentId",
            s.full_name   AS "fullName",
            s.student_code AS "studentCode"
     FROM student_group_members ms
     JOIN students s ON s.id = ms.student_id
     WHERE ms.group_id = $1 AND ms.left_on IS NULL AND s.deleted_at IS NULL
     ORDER BY lower(s.full_name)`,
    [assignment.groupId]
  );
  return new Map(result.rows.map((row) => [row.membershipId, row]));
}

// Read stored cells. `filters` = { sessionId?, assignmentId?, studentId?,
// parameterId? } — at least one is required so this can never become a
// full-table dump.
export async function getEvaluations(filters = {}) {
  const db = getDb();
  const { sessionId, assignmentId, parameterId, studentId } = filters;
  const conditions = ['e.archived_at IS NULL'];
  const values = [];

  if (sessionId !== undefined) {
    if (!isUuid(sessionId)) {
      throw ServiceError.validation('sessionId must be a valid ID.');
    }
    values.push(sessionId);
    conditions.push(`e.session_id = $${values.length}`);
  }
  if (assignmentId !== undefined) {
    if (!isUuid(assignmentId)) {
      throw ServiceError.validation('assignmentId must be a valid ID.');
    }
    values.push(assignmentId);
    conditions.push(`s.assignment_id = $${values.length}`);
  }
  if (parameterId !== undefined) {
    if (!isUuid(parameterId)) {
      throw ServiceError.validation('parameterId must be a valid ID.');
    }
    values.push(parameterId);
    conditions.push(`e.parameter_id = $${values.length}`);
  }
  if (studentId !== undefined) {
    if (!isUuid(studentId)) {
      throw ServiceError.validation('studentId must be a valid ID.');
    }
    // The student's own member rows AND the whole-group rows of any group
    // they are (or were) a member of — both kinds concern them.
    values.push(studentId);
    conditions.push(
      `(e.membership_id IN (SELECT id FROM student_group_members WHERE student_id = $${values.length})
        OR (e.membership_id IS NULL AND EXISTS (
              SELECT 1 FROM assignments a2
              JOIN student_group_members m2 ON m2.group_id = a2.group_id
              WHERE a2.id = s.assignment_id AND m2.student_id = $${values.length})))`
    );
  }

  if (values.length === 0) {
    throw ServiceError.validation(
      'Add at least one filter: sessionId, assignmentId, studentId or parameterId.',
      { code: 'EVALUATIONS_FILTER_REQUIRED' }
    );
  }

  const result = await db.query(
    `${EVALUATION_SELECT}
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.session_date, s.seq, e.parameter_id, e.membership_id NULLS FIRST
     LIMIT 20000`,
    values
  );
  return { evaluations: result.rows };
}

// Bulk-save one session's cells. `input` = { sessionId, entries,
// overrideReason?, dryRun?, source? }. Each entry: { membershipId (null =
// whole group), parameterId, selected, qualityValue, quantityValue,
// qualityComment?, quantityComment? } — the full cell state.
export async function saveEvaluationsBulk(input = {}) {
  const db = getDb();
  const {
    sessionId,
    entries,
    overrideReason: reasonInput,
    dryRun = false,
    source,
  } = input;

  if (typeof dryRun !== 'boolean') {
    throw ServiceError.validation('dryRun must be true or false.');
  }
  if (source !== undefined && source !== 'import') {
    throw ServiceError.validation('Unknown source.');
  }
  if (!isUuid(sessionId)) {
    throw ServiceError.validation('sessionId must be a valid ID.');
  }
  const shapeError = validateShape(entries);
  if (shapeError) {
    throw ServiceError.validation(shapeError, { code: 'EVALUATIONS_INVALID_SHAPE' });
  }
  // Normalise comments now so every later comparison uses the clean value.
  for (const entry of entries) {
    if ('qualityComment' in entry) {
      entry.qualityComment = normalizeComment(entry.qualityComment);
    }
    if ('quantityComment' in entry) {
      entry.quantityComment = normalizeComment(entry.quantityComment);
    }
  }

  const sessionResult = await db.query(
    `SELECT s.id              AS "sessionId",
            s.code            AS "sessionCode",
            s.session_date::text AS "sessionDate",
            s.canceled_at     AS "canceledAt",
            s.archived_at     AS "archivedAt",
            a.group_id        AS "groupId",
            a.membership_id   AS "assignmentMembershipId",
            a.code            AS "assignmentCode",
            a.name            AS "assignmentName"
     FROM sessions s
     JOIN assignments a ON a.id = s.assignment_id
     WHERE s.id = $1`,
    [sessionId]
  );
  const session = sessionResult.rows[0];
  if (!session) {
    throw ServiceError.notFound('Session not found.');
  }
  if (session.canceledAt || session.archivedAt) {
    throw ServiceError.conflict(
      'This session is canceled or archived; its cells cannot change.',
      { code: 'SESSIONS_NOT_ACTIVE' }
    );
  }

  const [targets, parametersResult] = await Promise.all([
    loadTargets(db, session),
    db.query(
      `SELECT id, name, min_value AS "minValue", max_value AS "maxValue"
       FROM parameters`
    ),
  ]);
  const parameters = new Map(
    parametersResult.rows.map((parameter) => [parameter.id, parameter])
  );

  // An individual assignment's rows must target its own member (never the
  // whole group — a one-student schedule has no "group" to evaluate).
  if (
    session.assignmentMembershipId &&
    entries.some((entry) => entry.membershipId === null)
  ) {
    throw ServiceError.validation(
      'This assignment targets a single student; whole-group rows are not allowed.',
      { code: 'EVALUATIONS_TARGET_MISMATCH' }
    );
  }

  const problems = findProblems({ entries, parameters, memberships: targets });

  if (dryRun) {
    const existingResult = await db.query(
      `SELECT membership_id       AS "membershipId",
              parameter_id        AS "parameterId",
              quality_value       AS "qualityValue",
              quantity_value      AS "quantityValue",
              quality_comment     AS "qualityComment",
              quantity_comment    AS "quantityComment",
              locks_at            AS "locksAt",
              (locks_at <= now()) AS "isLocked"
       FROM evaluations
       WHERE session_id = $1 AND archived_at IS NULL
       FOR UPDATE`,
      [sessionId]
    );
    const existing = new Map(
      existingResult.rows.map((row) => [
        cellKey(row.membershipId, row.parameterId),
        row,
      ])
    );
    const cells = previewCells({
      entries,
      existing,
      problemIndexes: new Set(problems.map((problem) => problem.index)),
      canViewScores: true,
    });
    return {
      dryRun: true,
      sessionId,
      cells,
      problems,
      counts: previewCounts(cells, problems),
    };
  }

  if (problems.length > 0) {
    throw ServiceError.validation('Some entries are invalid. Nothing was saved.', {
      code: 'EVALUATIONS_INVALID_ENTRIES',
      problems,
    });
  }

  return saveBulk({
    db,
    session,
    entries,
    targets,
    parameters,
    reasonInput,
    source,
  });
}

// The transactional write, reached only after validation passed and dryRun is
// false. Locks the session's rows FOR UPDATE, resolves the override reason for
// any locked change (the single admin may always override, but a locked change
// still demands a written reason — audited), then applies each entry as a
// delete (unselect) or an upsert and records one audit row for the batch with
// old_data/new_data cell snapshots.
async function saveBulk({
  db,
  session,
  entries,
  targets,
  parameters,
  reasonInput,
  source,
}) {
  const { sessionId } = session;
  const locksAt = locksAtFor({ sessionDate: session.sessionDate, today: todayIso() });
  const changes = [];
  const snapshots = { old: [], new: [] };
  let overrideReason = null;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const existingResult = await client.query(
      `SELECT id,
              membership_id       AS "membershipId",
              parameter_id        AS "parameterId",
              quality_value       AS "qualityValue",
              quantity_value      AS "quantityValue",
              quality_comment     AS "qualityComment",
              quantity_comment    AS "quantityComment",
              locks_at            AS "locksAt",
              (locks_at <= now()) AS "isLocked"
       FROM evaluations
       WHERE session_id = $1 AND archived_at IS NULL
       ORDER BY membership_id NULLS FIRST, parameter_id
       FOR UPDATE`,
      [sessionId]
    );
    const existing = new Map(
      existingResult.rows.map((row) => [
        cellKey(row.membershipId, row.parameterId),
        row,
      ])
    );

    const lockedChanges = findLockedChanges({ entries, existing });
    const overriddenKeys = new Set(
      lockedChanges.map((item) => cellKey(item.membershipId, item.parameterId))
    );

    // Single admin: the "no override permission" 409 path is gone. The lock is
    // still a guardrail — a locked change needs a written reason, which we audit.
    if (lockedChanges.length > 0) {
      const reason = parseOverrideReason(reasonInput);
      if (reason.error) {
        await client.query('ROLLBACK').catch(() => {});
        throw ServiceError.validation(reason.error, {
          code: 'OVERRIDE_REASON_REQUIRED',
          problems: lockedChanges.map((item) => ({
            index: item.index,
            membershipId: item.membershipId,
            parameterId: item.parameterId,
            message: 'Locked. Changing it needs a written reason.',
          })),
        });
      }
      overrideReason = reason.value;
    }

    for (const entry of entries) {
      const key = cellKey(entry.membershipId, entry.parameterId);
      const row = existing.get(key);
      const to = {
        selected: entry.selected,
        qualityValue: entry.qualityValue ?? null,
        quantityValue: entry.quantityValue ?? null,
        qualityComment: entry.qualityComment ?? null,
        quantityComment: entry.quantityComment ?? null,
      };
      const before = row
        ? {
            selected: true,
            qualityValue: row.qualityValue,
            quantityValue: row.quantityValue,
            qualityComment: row.qualityComment,
            quantityComment: row.quantityComment,
          }
        : null;

      let result;
      if (!entry.selected) {
        // Unselect: drop the row entirely (a stored row IS the expectation).
        if (!row) continue;
        result = await client.query('DELETE FROM evaluations WHERE id = $1', [
          row.id,
        ]);
      } else {
        result = await client.query(
          `INSERT INTO evaluations
             (session_id, parameter_id, membership_id,
              quality_value, quantity_value, quality_comment, quantity_comment,
              locks_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (session_id, parameter_id, membership_id) DO UPDATE
             SET quality_value    = EXCLUDED.quality_value,
                 quantity_value   = EXCLUDED.quantity_value,
                 quality_comment  = EXCLUDED.quality_comment,
                 quantity_comment = EXCLUDED.quantity_comment,
                 locks_at         = EXCLUDED.locks_at,
                 updated_at       = now()
           WHERE evaluations.quality_value    IS DISTINCT FROM EXCLUDED.quality_value
              OR evaluations.quantity_value   IS DISTINCT FROM EXCLUDED.quantity_value
              OR evaluations.quality_comment  IS DISTINCT FROM EXCLUDED.quality_comment
              OR evaluations.quantity_comment IS DISTINCT FROM EXCLUDED.quantity_comment`,
          [
            sessionId,
            entry.parameterId,
            entry.membershipId,
            to.qualityValue,
            to.quantityValue,
            to.qualityComment,
            to.quantityComment,
            locksAt,
          ]
        );
      }

      if (result.rowCount > 0) {
        const target = entry.membershipId ? targets.get(entry.membershipId) : null;
        const parameter = parameters.get(entry.parameterId);
        changes.push({
          membershipId: entry.membershipId,
          student: target ? target.fullName : null,
          studentCode: target ? target.studentCode : null,
          parameterId: entry.parameterId,
          parameter: parameter.name,
          from: before,
          to,
          override: overriddenKeys.has(key),
        });
        snapshots.old.push(
          before ? { key, ...before } : { key, existed: false }
        );
        snapshots.new.push(
          entry.selected ? { key, ...to } : { key, deleted: true }
        );
      }
    }

    if (changes.length > 0) {
      const actor = getLocalActor();
      await recordAudit(client, {
        userId: actor.userId,
        actor: actor.actor,
        action: 'scores.save',
        entityType: 'session',
        entityId: sessionId,
        details: {
          sessionId,
          sessionCode: session.sessionCode,
          assignmentCode: session.assignmentCode,
          count: changes.length,
          changes,
          ...(source === 'import' ? { source: 'import' } : {}),
          ...(overrideReason ? { overrideReason } : {}),
        },
        oldData: { cells: snapshots.old },
        newData: { cells: snapshots.new },
      });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // The range trigger speaks in check_violation; translate the common case.
    if (err.code === '23514') {
      throw ServiceError.validation(
        'A value is outside the parameter range. Nothing was saved.',
        { code: 'EVALUATIONS_INVALID_ENTRIES' }
      );
    }
    throw err;
  } finally {
    client.release();
  }

  return { sessionId, changed: changes.length };
}
