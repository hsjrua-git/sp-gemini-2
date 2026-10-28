// session_unconfirmed: a session whose date has passed with no record at all —
// not canceled, no note, no tasks. The scan raises these alerts idempotently
// and closes the ones whose session has since been taken care of, so the OPEN
// list stays truthful without a background job.

// `db` is a pool or client. Returns the number of alerts raised and resolved.
export async function scanAlerts(db) {
  // Raise. The first NOT EXISTS keeps one OPEN alert per session; ON CONFLICT
  // covers the same-index race between concurrent scans. The second NOT EXISTS
  // honors a manual resolution: an alert resolved at or after the session's
  // last change means the user already dismissed exactly this state, so it
  // must not come back on the next scan. Only when the session changes again
  // (note added then removed, uncanceled, tasks deleted — bumping updated_at
  // past the resolution) can the alert be raised anew.
  const raised = await db.query(`
    INSERT INTO alerts (kind, session_id, message)
    SELECT 'session_unconfirmed', s.id,
           'Session ' || s.code
           || ' on ' || to_char(s.session_date, 'YYYY-MM-DD')
           || ' passed with no record: not canceled, no note, no tasks.'
    FROM sessions s
    WHERE s.session_date < CURRENT_DATE
      AND s.canceled_at IS NULL
      AND s.archived_at IS NULL
      AND s.note IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks tk WHERE tk.session_id = s.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM evaluations e
        WHERE e.session_id = s.id AND e.archived_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM alerts op
        WHERE op.kind = 'session_unconfirmed'
          AND op.session_id = s.id
          AND op.resolved_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM alerts rs
        WHERE rs.kind = 'session_unconfirmed'
          AND rs.session_id = s.id
          AND rs.resolved_at IS NOT NULL
          AND rs.resolved_at >= s.updated_at
      )
    ON CONFLICT DO NOTHING
  `);

  // Cleanup: close open alerts whose session has since been canceled,
  // archived, annotated, evaluated or given tasks (the problem is gone).
  const resolved = await db.query(`
    UPDATE alerts a
    SET resolved_at = now()
    WHERE a.kind = 'session_unconfirmed'
      AND a.resolved_at IS NULL
      AND EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id = a.session_id
          AND (s.canceled_at IS NOT NULL
               OR s.archived_at IS NOT NULL
               OR s.note IS NOT NULL
               OR EXISTS (SELECT 1 FROM tasks tk WHERE tk.session_id = s.id)
               OR EXISTS (
                 SELECT 1 FROM evaluations e
                 WHERE e.session_id = s.id AND e.archived_at IS NULL
               ))
      )
  `);

  return { raised: raised.rowCount, resolved: resolved.rowCount };
}
