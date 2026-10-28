// Periods under the schema-4 model: per-assignment, not a global calendar.
// Every four non-canceled sessions of an assignment (ordered by effective
// date) form one period — seq 1, 2, 3… The bucketing itself is a pure
// function so the tests can hammer it; the materialization keeps the
// `periods` rows (the stable IDs the rest of the app references) in step
// idempotently whenever sessions are generated, moved, canceled or archived.
//
// The old global calendar (period_anchor_date + 7-day weeks) is gone: there
// is no "current period" for the school, only each assignment's latest period.

export const SESSIONS_PER_PERIOD = 4;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayNumber(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function isoDateFromDayNumber(days) {
  return new Date(days * MS_PER_DAY).toISOString().slice(0, 10);
}

export function isValidIsoDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  return isoDateFromDayNumber(dayNumber(text)) === text;
}

export function todayIso(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Pure. Given ONE assignment's sessions shaped
// [{ id, seq, sessionDate, canceledAt, archivedAt }], return a Map of
// session.id → period seq (1-based). Only live sessions bucket (canceled and
// archived ones sit outside every period); the order is effective date, then
// seq as the tiebreak.
function isoDateKey(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value ?? '').slice(0, 10);
}

export function assignPeriods(sessions) {
  const live = (sessions ?? [])
    .filter((session) => session.canceledAt == null && session.archivedAt == null)
    .sort(
      (a, b) =>
        isoDateKey(a.sessionDate).localeCompare(isoDateKey(b.sessionDate)) ||
        a.seq - b.seq
    );
  const map = new Map();
  live.forEach((session, index) => {
    map.set(session.id, Math.floor(index / SESSIONS_PER_PERIOD) + 1);
  });
  return map;
}

// Materialize the period rows for one assignment so every bucket that has at
// least one live session has a row, and stale rows (buckets emptied by
// moves/cancels) are archived. Idempotent; safe inside a transaction.
export async function syncAssignmentPeriods(db, assignmentId) {
  const sessions = await db.query(
    `SELECT id, seq,
            session_date::text AS "sessionDate",
            canceled_at        AS "canceledAt",
            archived_at        AS "archivedAt"
     FROM sessions
     WHERE assignment_id = $1`,
    [assignmentId]
  );
  const bucketCount = Math.ceil(
    assignPeriods(sessions.rows).size / SESSIONS_PER_PERIOD
  );

  if (bucketCount > 0) {
    await db.query(
      `INSERT INTO periods (assignment_id, seq)
       SELECT $1, seq
       FROM generate_series(1, $2::int) AS seq
       ON CONFLICT (assignment_id, seq) DO UPDATE
         SET archived_at = NULL, updated_at = now()`,
      [assignmentId, bucketCount]
    );
  }
  // Buckets that no longer exist (sessions moved away or were archived) are
  // archived, never deleted: evaluations may still reference their sessions.
  await db.query(
    `UPDATE periods SET archived_at = now()
     WHERE assignment_id = $1
       AND archived_at IS NULL
       AND seq > $2`,
    [assignmentId, bucketCount]
  );
  return bucketCount;
}

// The period list for one assignment, with each period's date span, session
// count and answered-cell count derived from its member sessions. Rows must
// already be materialized (callers run syncAssignmentPeriods first); periods
// appear in seq order. `answeredCount` (cells with a value or comment) is
// score-derived data — the route strips it for callers without scores.view.
export async function listAssignmentPeriods(db, assignmentId) {
  const result = await db.query(
    `WITH bucketed AS (
       SELECT s.id AS session_id,
              s.session_date AS "sessionDate",
              (ROW_NUMBER() OVER (ORDER BY s.session_date, s.seq) - 1)
                / $2::int + 1 AS seq
       FROM sessions s
       WHERE s.assignment_id = $1
         AND s.canceled_at IS NULL
         AND s.archived_at IS NULL
     ),
     answered AS (
       SELECT b.seq, count(e.id)::int AS answered
       FROM bucketed b
       JOIN evaluations e ON e.session_id = b.session_id
        AND e.archived_at IS NULL
        AND (e.quality_value IS NOT NULL OR e.quantity_value IS NOT NULL
             OR e.quality_comment IS NOT NULL OR e.quantity_comment IS NOT NULL)
       GROUP BY b.seq
     )
     SELECT p.id,
            p.seq,
            p.archived_at AS "archivedAt",
            count(b.session_id)::int AS "sessionCount",
            min(b."sessionDate")::text AS "startDate",
            max(b."sessionDate")::text AS "endDate",
            COALESCE(a.answered, 0) AS "answeredCount"
     FROM periods p
     LEFT JOIN bucketed b ON b.seq = p.seq
     LEFT JOIN answered a ON a.seq = p.seq
     WHERE p.assignment_id = $1
     GROUP BY p.id, p.seq, p.archived_at, a.answered
     ORDER BY p.seq`,
    [assignmentId, SESSIONS_PER_PERIOD]
  );
  return result.rows;
}

// The period seq a session belongs to (by effective date), given the
// assignment's live sessions in any order. NULL when the session is canceled
// or archived — outside every period.
export function periodSeqForSession(sessions, sessionId) {
  return assignPeriods(sessions).get(sessionId) ?? null;
}
