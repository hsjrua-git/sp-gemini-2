import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { isUuid } from '../lib/ids.js';
import { isValidIsoDate, todayIso } from '../lib/periods.js';
import { locksAtFor } from '../lib/locks.js';
import { assignPeriods, syncAssignmentPeriods } from '../lib/periods.js';
import { generateSessions } from '../lib/sessions.js';

const router = Router();
const MAX_LISTED = 500;

const SESSION_COLUMNS = `
  s.id,
  s.assignment_id  AS "assignmentId",
  s.seq,
  s.code,
  s.planned_date::text AS "plannedDate",
  s.moved_to::text     AS "movedTo",
  s.session_date::text AS "sessionDate",
  s.canceled_at    AS "canceledAt",
  s.note,
  s.archived_at    AS "archivedAt",
  (SELECT count(*)::int FROM tasks tk WHERE tk.session_id = s.id)
                  AS "taskCount",
  a.code           AS "assignmentCode",
  a.name           AS "assignmentName",
  t.full_name      AS "teacherName",
  a.group_id       AS "groupId",
  g.name           AS "groupName",
  a.membership_id  AS "membershipId",
  sf.full_name     AS "studentName"
`;

const SESSION_FROM = `
  FROM sessions s
  JOIN assignments a ON a.id = s.assignment_id
  JOIN teachers t ON t.id = a.teacher_id
  LEFT JOIN student_groups g ON g.id = a.group_id
  LEFT JOIN student_group_members ms ON ms.id = a.membership_id
  LEFT JOIN students sf ON sf.id = ms.student_id
`;

// Label each session with its assignment's period seq (the deterministic
// 4-sessions-per-period bucketing; canceled/archived sessions sit outside
// every period and get null). Always buckets against ALL sessions of the
// affected assignments so date/status filters or single-row fetches never
// renumber periods from 1.
async function withPeriodSeqs(db, sessions) {
  if (sessions.length === 0) return [];
  const assignmentIds = [...new Set(sessions.map((s) => s.assignmentId))];
  const allRows = await db.query(
    `SELECT id,
            assignment_id AS "assignmentId",
            seq,
            session_date::text AS "sessionDate",
            canceled_at   AS "canceledAt",
            archived_at   AS "archivedAt"
     FROM sessions
     WHERE assignment_id = ANY($1::uuid[])`,
    [assignmentIds]
  );
  const byAssignment = new Map();
  for (const row of allRows.rows) {
    if (!byAssignment.has(row.assignmentId)) {
      byAssignment.set(row.assignmentId, []);
    }
    byAssignment.get(row.assignmentId).push(row);
  }
  const labels = new Map();
  for (const rows of byAssignment.values()) {
    for (const [id, seq] of assignPeriods(rows)) labels.set(id, seq);
  }
  return sessions.map((session) => ({
    ...session,
    periodSeq: labels.get(session.id) ?? null,
  }));
}

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(404).json({
      error: 'Session not found.',
      code: 'NOT_FOUND',
      params: { entity: 'session' },
    });
  }
  next();
});

router.get('/', async (req, res) => {
  const { assignmentId, teacherId, from, to } = req.query;
  const includeCanceled = req.query.includeCanceled === '1';
  const includeArchived = req.query.includeArchived === '1';

  const conditions = [includeArchived ? 'TRUE' : 's.archived_at IS NULL'];
  const values = [];
  const push = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (assignmentId !== undefined) {
    if (!isUuid(assignmentId)) {
      return res.status(400).json({
        error: 'assignmentId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'assignmentId' },
      });
    }
    conditions.push(`s.assignment_id = ${push(assignmentId)}`);
  }
  if (teacherId !== undefined) {
    if (!isUuid(teacherId)) {
      return res.status(400).json({
        error: 'teacherId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'teacherId' },
      });
    }
    conditions.push(`a.teacher_id = ${push(teacherId)}`);
  }
  if (from !== undefined) {
    if (!isValidIsoDate(from)) {
      return res.status(400).json({
        error: 'from must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
        params: { field: 'from' },
      });
    }
    conditions.push(`s.session_date >= ${push(from)}::date`);
  }
  if (to !== undefined) {
    if (!isValidIsoDate(to)) {
      return res.status(400).json({
        error: 'to must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
        params: { field: 'to' },
      });
    }
    conditions.push(`s.session_date <= ${push(to)}::date`);
  }
  if (!includeCanceled) {
    conditions.push('s.canceled_at IS NULL');
  }

  const result = await pool.query(
    `SELECT ${SESSION_COLUMNS}
     ${SESSION_FROM}
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.session_date, s.code
     LIMIT ${MAX_LISTED + 1}`,
    values
  );

  const sessions = await withPeriodSeqs(pool, result.rows.slice(0, MAX_LISTED));

  res.json({ sessions, truncated: result.rows.length > MAX_LISTED });
});

// Generate the missing planned sessions for active assignments, up to a
// horizon date. Idempotent: existing planned dates are skipped.
router.post('/generate', async (req, res) => {
  const until = req.body?.until;
  if (!isValidIsoDate(until)) {
    return res.status(400).json({
      error: 'until must be a real date written as YYYY-MM-DD.',
      code: 'VALIDATION_INVALID_DATE',
      params: { field: 'until' },
    });
  }
  const assignmentId = req.body?.assignmentId ?? null;
  if (assignmentId !== null && !isUuid(assignmentId)) {
    return res.status(400).json({
      error: 'assignmentId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'assignmentId' },
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await generateSessions(client, { until, assignmentId });
    if (created > 0) {
      // New sessions fill out the period buckets — materialize them.
      for (const row of (await client.query(
        `SELECT id FROM assignments
         WHERE archived_at IS NULL
           ${assignmentId ? 'AND id = $1' : ''}`,
        assignmentId ? [assignmentId] : []
      )).rows) {
        await syncAssignmentPeriods(client, row.id);
      }
      await recordAudit(client, {
        userId: req.user.id,
        actor: req.user.username,
        action: 'session.generate',
        entityType: 'session',
        details: { until, assignmentId, created },
      });
    }
    await client.query('COMMIT');
    res.status(201).json({ created, until });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Only the operational fields change: moving a session, canceling it, or
// annotating it. The planned date, sequence and code are immutable.
router.patch('/:id', async (req, res) => {
  const body =
    req.body !== null && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {};
  const sets = [];
  const values = [];

  if ('movedTo' in body) {
    const movedTo = body.movedTo;
    if (movedTo !== null && !isValidIsoDate(movedTo)) {
      return res.status(400).json({
        error: 'movedTo must be a date (YYYY-MM-DD) or null.',
        code: 'VALIDATION_INVALID_DATE',
        params: { field: 'movedTo' },
      });
    }
    values.push(movedTo);
    sets.push(`moved_to = $${values.length}::date`);
  }
  if ('canceled' in body) {
    if (typeof body.canceled !== 'boolean') {
      return res.status(400).json({
        error: 'canceled must be true or false.',
        code: 'VALIDATION_INVALID_TYPE',
      });
    }
    sets.push(`canceled_at = ${body.canceled ? 'now()' : 'NULL'}`);
  }
  if ('note' in body) {
    const note = body.note;
    if (note !== null && typeof note !== 'string') {
      return res.status(400).json({
        error: 'note must be text.',
        code: 'VALIDATION_INVALID_TYPE',
      });
    }
    const trimmed = note?.trim() ?? '';
    if (trimmed.length > 500) {
      return res.status(400).json({
        error: 'note must be 500 characters or fewer.',
        code: 'VALIDATION_TOO_LONG',
        params: { max: 500 },
      });
    }
    values.push(trimmed === '' ? null : trimmed);
    sets.push(`note = $${values.length}`);
  }
  if ('archived' in body) {
    if (typeof body.archived !== 'boolean') {
      return res.status(400).json({
        error: 'archived must be true or false.',
        code: 'VALIDATION_INVALID_TYPE',
      });
    }
    sets.push(`archived_at = ${body.archived ? 'now()' : 'NULL'}`);
  }
  if (sets.length === 0) {
    return res.status(400).json({
      error: 'Nothing to change.',
      code: 'VALIDATION_NOTHING_TO_CHANGE',
    });
  }

  values.push(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE sessions
       SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, assignment_id,
                 session_date::text AS "sessionDate"`,
      values
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Session not found.',
        code: 'NOT_FOUND',
        params: { entity: 'session' },
      });
    }
    const updated = result.rows[0];

    // A move changes the effective date: the lock windows of still-unlocked
    // rows re-anchor to the new date (locked ones keep their old window —
    // changing them already needs an override).
    if ('movedTo' in body) {
      await client.query(
        `UPDATE evaluations
         SET locks_at = $1
         WHERE session_id = $2 AND locks_at > now()`,
        [
          locksAtFor({ sessionDate: updated.sessionDate, today: todayIso() }),
          req.params.id,
        ]
      );
    }
    // Any operational change can re-bucket the assignment's periods.
    await syncAssignmentPeriods(client, updated.assignment_id);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const full = await pool.query(
    `SELECT ${SESSION_COLUMNS} ${SESSION_FROM} WHERE s.id = $1`,
    [req.params.id]
  );
  const [labeled] = await withPeriodSeqs(pool, full.rows);
  res.json({ session: labeled });
});

export default router;
