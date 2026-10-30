import { createHash } from 'node:crypto';
import { isUuid } from './ids.js';
import { isValidIsoDate } from './periods.js';

export function parseSessionPlan(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid session plan.', code: 'SESSION_PLAN_INVALID' };
  const ids = body.assignmentIds ?? (body.assignmentId ? [body.assignmentId] : []);
  const mode = body.mode ?? 'date';
  const count = body.count;
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every(isUuid) ||
      !['date', 'sessions', 'periods'].includes(mode) ||
      (mode === 'date' && !isValidIsoDate(body.until)) ||
      (mode !== 'date' && (!Number.isInteger(count) || count < 1 || count > (mode === 'periods' ? 50 : 200))) ||
      (body.from != null && body.from !== '' && !isValidIsoDate(body.from)) ||
      (mode === 'date' && body.from && body.from > body.until)) {
    return { error: 'Select assignments and a valid date range or bounded session/period count.', code: 'SESSION_PLAN_INVALID' };
  }
  return { value: { assignmentIds: [...new Set(ids)].sort(), mode, count: mode === 'date' ? 1001 : count * (mode === 'periods' ? 4 : 1),
    from: body.from || null, until: mode === 'date' ? body.until : null } };
}

export async function planSessions(db, options) {
  // Serializes two confirmations and protects teacher/interval edits while the
  // exact preview is recomputed. All callers lock in the same ID order.
  const targets = await db.query(
    `SELECT a.id FROM assignments a JOIN teachers t ON t.id = a.teacher_id
     JOIN intervals i ON i.id = a.interval_id
     WHERE a.id = ANY($1::uuid[]) AND a.archived_at IS NULL
       AND t.archived_at IS NULL AND i.archived_at IS NULL
     ORDER BY a.id FOR UPDATE OF a FOR SHARE OF t, i`, [options.assignmentIds]
  );
  if (targets.rowCount !== options.assignmentIds.length) return { error: 'A selected schedule is inactive.', code: 'SESSION_PLAN_INVALID' };
  const rows = (await db.query(
    `WITH candidates AS (
       SELECT a.id AS "assignmentId", COALESCE(a.name, a.code) AS "assignmentName",
              a.code || '-' || lpad((start.seq + g)::text, greatest(3, length((start.seq + g)::text)), '0') AS code,
              (start.seq + g)::int AS seq,
              (a.anchor_date + (start.seq + g - 1) * i.every)::date AS planned,
              t.full_name AS "teacherName", COALESCE(gr.name, st.full_name) AS target
       FROM assignments a JOIN intervals i ON i.id = a.interval_id JOIN teachers t ON t.id = a.teacher_id
       LEFT JOIN student_groups gr ON gr.id = a.group_id
       LEFT JOIN student_group_members ms ON ms.id = a.membership_id LEFT JOIN students st ON st.id = ms.student_id
        CROSS JOIN LATERAL (SELECT COALESCE(MAX(s.seq), 0) AS seq FROM sessions s WHERE s.assignment_id = a.id) last
        CROSS JOIN LATERAL (SELECT greatest(last.seq, CASE WHEN $2::date IS NULL THEN 0
          WHEN extract(year FROM i.every) * 12 + extract(month FROM i.every) > 0 THEN
            floor((extract(year FROM age($2::date, a.anchor_date)) * 12 + extract(month FROM age($2::date, a.anchor_date))) /
              (extract(year FROM i.every) * 12 + extract(month FROM i.every)))::int - 1
          ELSE floor(($2::date - a.anchor_date) / greatest(1, extract(epoch FROM i.every) / 86400))::int - 1 END) AS seq) start
        CROSS JOIN generate_series(1, 1003) g WHERE a.id = ANY($1::uuid[])
     ), ranked AS (
       SELECT *, row_number() OVER (PARTITION BY "assignmentId" ORDER BY seq) AS n
       FROM candidates WHERE ($2::date IS NULL OR planned >= $2) AND ($3::date IS NULL OR planned <= $3)
     ) SELECT "assignmentId", "assignmentName", "teacherName", target, code, seq, planned::text AS "plannedDate"
       FROM ranked WHERE n <= $4 ORDER BY "assignmentId", seq LIMIT 1001`,
    [options.assignmentIds, options.from, options.until, options.count]
  )).rows;
  if (rows.length > 1000) return { error: 'The plan is too large. Choose fewer targets or dates.', code: 'SESSION_PLAN_LIMIT' };
  const token = createHash('sha256').update(JSON.stringify({ options, rows })).digest('hex');
  return { rows, token, count: rows.length };
}

export async function applySessionPlan(db, rows) {
  if (!rows.length) return 0;
  const result = await db.query(
    `INSERT INTO sessions (assignment_id, seq, code, planned_date)
     SELECT x."assignmentId", x.seq, x.code, x."plannedDate" FROM jsonb_to_recordset($1::jsonb)
       AS x("assignmentId" uuid, seq integer, code text, "plannedDate" date) RETURNING id`, [JSON.stringify(rows)]
  );
  return result.rowCount;
}
