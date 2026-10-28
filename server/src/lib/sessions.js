// Generating sessions from assignments: for every active assignment, create
// the missing planned dates (anchor + n * interval) up to a horizon. The date
// arithmetic happens in Postgres so interval semantics (month lengths, in
// particular) match exactly what the database would compute.

const MAX_PER_ASSIGNMENT = 1000;

// `db` is a pool or client; `until` is an ISO date. Returns the number of
// sessions created. When assignmentId is given, only that assignment is
// processed (it must be active).
export async function generateSessions(db, { until, assignmentId = null }) {
  const targets = assignmentId
    ? await db.query(
        `SELECT id, code FROM assignments
         WHERE id = $1 AND archived_at IS NULL`,
        [assignmentId]
      )
    : await db.query(
        'SELECT id, code FROM assignments WHERE archived_at IS NULL'
      );

  let created = 0;
  for (const assignment of targets.rows) {
    const result = await db.query(
      `WITH last AS (
         SELECT COALESCE(max(seq), 0) AS last_seq
         FROM sessions
         WHERE assignment_id = $1
       ),
       next_dates AS (
         -- Session n happens at anchor + (n-1) * interval, so seq 1 is the
         -- anchor date itself and generation resumes after the last stored seq.
         SELECT (a.anchor_date + (last.last_seq + g - 1) * iv.every)::date AS planned,
                (last.last_seq + g) AS next_seq
         FROM assignments a
         JOIN intervals iv ON iv.id = a.interval_id
         CROSS JOIN last
         CROSS JOIN generate_series(1, $3) g
         WHERE a.id = $1
           AND (a.anchor_date + (last.last_seq + g - 1) * iv.every)::date <= $2::date
       )
       INSERT INTO sessions (assignment_id, seq, code, planned_date)
       SELECT $1, next_seq, $4 || '-' || lpad(next_seq::text, 3, '0'), planned
       FROM next_dates
       ON CONFLICT DO NOTHING`,
      [assignment.id, until, MAX_PER_ASSIGNMENT, assignment.code]
    );
    created += result.rowCount;
  }
  return created;
}
