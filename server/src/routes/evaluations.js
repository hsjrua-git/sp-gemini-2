import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { isUuid } from '../lib/ids.js';
import {
  cellKey,
  findLockedChanges,
  locksAtFor,
  parseOverrideReason,
} from '../lib/locks.js';
import { todayIso } from '../lib/periods.js';
import { userCan } from '../middleware/auth.js';
import {
  findProblems,
  normalizeComment,
  validateShape,
} from '../lib/evaluationCheck.js';
import { previewCells, previewCounts } from '../lib/scorePreview.js';

const router = Router();

// The assignment's valid evaluation targets: for a group assignment every
// open membership of the group (plus the whole-group row), for an individual
// assignment exactly its own member. Maps membershipId → student info.
async function loadTargets(db, assignment) {
  if (assignment.assignmentMembershipId) {
    const result = await db.query(
      `SELECT ms.id            AS "membershipId",
              s.id             AS "studentId",
              s.full_name      AS "fullName",
              s.student_code   AS "studentCode"
       FROM student_group_members ms
       JOIN students s ON s.id = ms.student_id
       JOIN student_groups g ON g.id = ms.group_id AND g.archived_at IS NULL
       WHERE ms.id = $1
         AND ms.added_at::date <= $2::date
         AND (ms.left_on IS NULL OR ms.left_on >= $2::date)
         AND s.deleted_at IS NULL`,
      [assignment.assignmentMembershipId, assignment.sessionDate]
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
     JOIN student_groups g ON g.id = ms.group_id AND g.archived_at IS NULL
     WHERE ms.group_id = $1
       AND ms.added_at::date <= $2::date
       AND (ms.left_on IS NULL OR ms.left_on >= $2::date)
       AND s.deleted_at IS NULL
     ORDER BY lower(s.full_name)`,
    [assignment.groupId, assignment.sessionDate]
  );
  return new Map(result.rows.map((row) => [row.membershipId, row]));
}

const EVALUATION_SELECT = `
  SELECT e.id,
         e.session_id                    AS "sessionId",
         s.assignment_id                 AS "assignmentId",
         s.code                          AS "sessionCode",
         s.seq                           AS "sessionSeq",
         s.session_date::text            AS "sessionDate",
         p.seq                           AS "periodSeq",
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
  LEFT JOIN periods p ON p.id = s.period_id AND p.archived_at IS NULL
  LEFT JOIN student_group_members ms ON ms.id = e.membership_id
`;

// History and grid reads. Filters combine; at least one is required so the
// endpoint can never become a full-table dump.
router.get('/evaluations', async (req, res) => {
  const { sessionId, assignmentId, studentId, parameterId } = req.query;
  const conditions = ['e.archived_at IS NULL'];
  const values = [];

  if (sessionId !== undefined) {
    if (!isUuid(sessionId)) {
      return res.status(400).json({
        error: 'sessionId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'sessionId' },
      });
    }
    values.push(sessionId);
    conditions.push(`e.session_id = $${values.length}`);
  }
  if (assignmentId !== undefined) {
    if (!isUuid(assignmentId)) {
      return res.status(400).json({
        error: 'assignmentId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'assignmentId' },
      });
    }
    values.push(assignmentId);
    conditions.push(`s.assignment_id = $${values.length}`);
  }
  if (parameterId !== undefined) {
    if (!isUuid(parameterId)) {
      return res.status(400).json({
        error: 'parameterId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'parameterId' },
      });
    }
    values.push(parameterId);
    conditions.push(`e.parameter_id = $${values.length}`);
  }
  if (studentId !== undefined) {
    if (!isUuid(studentId)) {
      return res.status(400).json({
        error: 'studentId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'studentId' },
      });
    }
    // The student's own member rows AND the whole-group rows of any group
    // they are (or were) a member of — both kinds concern them.
    values.push(studentId);
    conditions.push(
      `(e.membership_id IN (SELECT id FROM student_group_members WHERE student_id = $${values.length})
        OR (e.membership_id IS NULL AND EXISTS (
               SELECT 1 FROM assignments a2
               JOIN student_group_members m2 ON m2.group_id = a2.group_id
               WHERE a2.id = s.assignment_id
                 AND m2.student_id = $${values.length}
                 AND m2.added_at::date <= s.session_date
                 AND (m2.left_on IS NULL OR m2.left_on >= s.session_date))))`
    );
  }

  if (values.length === 0) {
    return res.status(400).json({
      error:
        'Add at least one filter: sessionId, assignmentId, studentId or parameterId.',
      code: 'EVALUATIONS_FILTER_REQUIRED',
    });
  }

  const result = await pool.query(
    `${EVALUATION_SELECT}
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.session_date, s.seq, e.parameter_id, e.membership_id NULLS FIRST
     LIMIT 20000`,
    values
  );
  res.json({ evaluations: result.rows });
});

router.put('/evaluations/bulk', async (req, res) => {
  const {
    sessionId,
    entries,
    overrideReason: reasonInput,
    dryRun = false,
    source,
  } = req.body ?? {};

  if (typeof dryRun !== 'boolean') {
    return res.status(400).json({
      error: 'dryRun must be true or false.',
      code: 'VALIDATION_INVALID_TYPE',
    });
  }
  if (source !== undefined && source !== 'import') {
    return res.status(400).json({
      error: 'Unknown source.',
      code: 'VALIDATION_INVALID_CHOICE',
    });
  }
  if (!isUuid(sessionId)) {
    return res.status(400).json({
      error: 'sessionId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'sessionId' },
    });
  }
  const shapeError = validateShape(entries);
  if (shapeError) {
    return res.status(400).json({
      error: shapeError,
      code: 'EVALUATIONS_INVALID_SHAPE',
    });
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

  const sessionResult = await pool.query(
    `SELECT s.id,
            s.code                  AS "sessionCode",
            s.session_date::text    AS "sessionDate",
            s.canceled_at           AS "canceledAt",
            s.archived_at           AS "archivedAt",
            a.group_id              AS "groupId",
             a.membership_id         AS "assignmentMembershipId",
             a.code                  AS "assignmentCode",
             a.name                  AS "assignmentName",
             a.archived_at           AS "assignmentArchivedAt",
             g.archived_at           AS "groupArchivedAt"
     FROM sessions s
     JOIN assignments a ON a.id = s.assignment_id
     LEFT JOIN student_groups g ON g.id = a.group_id
     WHERE s.id = $1`,
    [sessionId]
  );
  const session = sessionResult.rows[0];
  if (!session) {
    return res.status(404).json({
      error: 'Session not found.',
      code: 'NOT_FOUND',
      params: { entity: 'session' },
    });
  }
  if (
    session.canceledAt ||
    session.archivedAt ||
    session.assignmentArchivedAt ||
    session.groupArchivedAt
  ) {
    return res.status(409).json({
      error: 'This session is canceled or archived; its cells cannot change.',
      code: 'SESSIONS_NOT_ACTIVE',
    });
  }

  const [targets, parametersResult] = await Promise.all([
    loadTargets(pool, session),
    pool.query(
      `SELECT id, name, min_value AS "minValue", max_value AS "maxValue"
       FROM parameters
       WHERE archived_at IS NULL`
    ),
  ]);
  const parameters = new Map(
    parametersResult.rows.map((parameter) => [parameter.id, parameter])
  );

  // An individual assignment's rows must target its own member (never the
  // whole group — a one-student schedule has no "group" to evaluate).
  if (session.assignmentMembershipId && entries.some((e) => e.membershipId === null)) {
    return res.status(400).json({
      error:
        'This assignment targets a single student; whole-group rows are not allowed.',
      code: 'EVALUATIONS_TARGET_MISMATCH',
    });
  }

  const problems = findProblems({ entries, parameters, memberships: targets });

  if (dryRun) {
    const existingResult = await pool.query(
      `SELECT membership_id       AS "membershipId",
              parameter_id        AS "parameterId",
              quality_value       AS "qualityValue",
              quantity_value      AS "quantityValue",
              quality_comment     AS "qualityComment",
              quantity_comment    AS "quantityComment",
              locks_at            AS "locksAt",
              (locks_at <= now()) AS "isLocked"
       FROM evaluations
       WHERE session_id = $1 AND archived_at IS NULL`,
      [sessionId]
    );
    const existing = new Map(
      existingResult.rows.map((row) => [
        cellKey(row.membershipId, row.parameterId),
        row,
      ])
    );
    // A blind-entry role (scores.enter but not scores.view) gets a redacted
    // preview: it may confirm what it is about to write, but never reads the
    // existing scores back. See previewCells + lib/permissions.js.
    const canViewScores = userCan(req, 'scores.view');
    const cells = previewCells({
      entries,
      existing,
      problemIndexes: new Set(problems.map((problem) => problem.index)),
      canViewScores,
    });
    return res.json({
      dryRun: true,
      sessionId,
      cells,
      problems,
      counts: previewCounts(cells, problems),
      ...(canViewScores ? {} : { redacted: true }),
    });
  }

  if (problems.length > 0) {
    return res.status(400).json({
      error: 'Some entries are invalid. Nothing was saved.',
      code: 'EVALUATIONS_INVALID_ENTRIES',
      problems,
    });
  }

  const locksAt = locksAtFor({
    sessionDate: session.sessionDate,
    today: todayIso(),
  });
  const changes = [];
  const snapshots = { old: [], new: [] };
  let overrideReason = null;

  const client = await pool.connect();
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
      lockedChanges.map((item) =>
        cellKey(item.membershipId, item.parameterId)
      )
    );

    if (lockedChanges.length > 0) {
      const lockedProblems = (message) =>
        lockedChanges.map((item) => ({
          index: item.index,
          membershipId: item.membershipId,
          parameterId: item.parameterId,
          message,
        }));

      if (!userCan(req, 'scores.override')) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Some scores are locked. Nothing was saved.',
          code: 'LOCKED',
          problems: lockedProblems('Locked. Only an administrator can change it.'),
        });
      }

      const reason = parseOverrideReason(reasonInput);
      if (reason.error) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: reason.error,
          code: 'OVERRIDE_REASON_REQUIRED',
          problems: lockedProblems('Locked. Changing it needs a written reason.'),
        });
      }
      overrideReason = reason.value;
    }
    if (overrideReason) {
      await client.query(
        `SELECT set_config('app.override_reason', $1, true)`,
        [overrideReason]
      );
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
        result = await client.query(
          'DELETE FROM evaluations WHERE id = $1',
          [row.id]
        );
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
        const target = entry.membershipId
          ? targets.get(entry.membershipId)
          : null;
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
      await recordAudit(client, {
        userId: req.user.id,
        actor: req.user.username,
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
    await client.query('ROLLBACK');
    // The range trigger speaks in check_violation; translate the common case.
    if (err.code === '23514' && /outside parameter .* range/.test(String(err.message))) {
      return res.status(400).json({
        error: 'A value is outside the parameter range. Nothing was saved.',
        code: 'EVALUATIONS_INVALID_ENTRIES',
      });
    }
    throw err;
  } finally {
    client.release();
  }

  res.json({ sessionId, changed: changes.length });
});

export default router;
