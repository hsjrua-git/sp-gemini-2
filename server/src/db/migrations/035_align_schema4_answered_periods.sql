-- Align periods with the authoritative schema-4 lifecycle:
--   * a generated/selected-only session does not occupy a period
--   * the first active answer attaches an active session to the newest period
--     with room (four sessions), creating the next sequence when necessary
--   * removing/archiving the final answer detaches the session
--   * archiving/canceling detaches; restoring reattaches only when an active
--     answer still exists
--
-- The application keeps its deliberate two-comment evaluation extension.

ALTER TABLE sessions
  ADD COLUMN period_id uuid REFERENCES periods (id);

CREATE INDEX sessions_period_idx ON sessions (period_id);

CREATE FUNCTION period_size() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 4 $$;

-- Migration backfill. The old implementation materialized periods from every
-- generated session, so first retire those derived rows. Reuse their stable
-- (assignment, seq) identities for answered history, ordered by the closest
-- available approximation of first-answer order.
UPDATE periods
SET archived_at = COALESCE(archived_at, now());

WITH answered_sessions AS (
  SELECT s.id,
         s.assignment_id,
         s.session_date,
         s.seq AS session_seq,
         min(e.created_at) AS first_answered_at
  FROM sessions s
  JOIN evaluations e
    ON e.session_id = s.id
   AND e.archived_at IS NULL
   AND evaluation_is_answered(
     e.quality_value,
     e.quantity_value,
     e.quality_comment,
     e.quantity_comment
   )
  WHERE s.archived_at IS NULL
    AND s.canceled_at IS NULL
  GROUP BY s.id, s.assignment_id, s.session_date, s.seq
), ranked AS (
  SELECT assignment_id,
         ((row_number() OVER (
             PARTITION BY assignment_id
             ORDER BY first_answered_at, session_date, session_seq, id
           ) - 1) / period_size() + 1)::integer AS period_seq
  FROM answered_sessions
), wanted AS (
  SELECT DISTINCT assignment_id, period_seq
  FROM ranked
)
INSERT INTO periods (assignment_id, seq)
SELECT assignment_id, period_seq
FROM wanted
ON CONFLICT (assignment_id, seq) DO UPDATE
SET archived_at = NULL,
    updated_at = now();

WITH answered_sessions AS (
  SELECT s.id,
         s.assignment_id,
         s.session_date,
         s.seq AS session_seq,
         min(e.created_at) AS first_answered_at
  FROM sessions s
  JOIN evaluations e
    ON e.session_id = s.id
   AND e.archived_at IS NULL
   AND evaluation_is_answered(
     e.quality_value,
     e.quantity_value,
     e.quality_comment,
     e.quantity_comment
   )
  WHERE s.archived_at IS NULL
    AND s.canceled_at IS NULL
  GROUP BY s.id, s.assignment_id, s.session_date, s.seq
), ranked AS (
  SELECT id,
         assignment_id,
         ((row_number() OVER (
             PARTITION BY assignment_id
             ORDER BY first_answered_at, session_date, session_seq, id
           ) - 1) / period_size() + 1)::integer AS period_seq
  FROM answered_sessions
)
UPDATE sessions s
SET period_id = p.id
FROM ranked r
JOIN periods p
  ON p.assignment_id = r.assignment_id
 AND p.seq = r.period_seq
 AND p.archived_at IS NULL
WHERE s.id = r.id;

CREATE FUNCTION sessions_period_assignment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.period_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM periods p
    WHERE p.id = NEW.period_id
      AND p.assignment_id = NEW.assignment_id
      AND p.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'session period must be an active period of its assignment'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sessions_period_assignment_guard_trg
  BEFORE INSERT OR UPDATE OF assignment_id, period_id ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_period_assignment_guard();

CREATE FUNCTION attach_session_to_period(p_session uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_assignment uuid;
  v_period uuid;
  v_archived timestamptz;
  v_canceled timestamptz;
BEGIN
  SELECT assignment_id, period_id, archived_at, canceled_at
  INTO v_assignment, v_period, v_archived, v_canceled
  FROM sessions
  WHERE id = p_session
  FOR UPDATE;

  IF NOT FOUND OR v_period IS NOT NULL THEN
    RETURN;
  END IF;
  IF v_archived IS NOT NULL OR v_canceled IS NOT NULL THEN
    RETURN;
  END IF;

  -- Serialize capacity checks and sequence creation per assignment.
  PERFORM 1
  FROM assignments
  WHERE id = v_assignment
  FOR NO KEY UPDATE;

  SELECT p.id
  INTO v_period
  FROM periods p
  WHERE p.assignment_id = v_assignment
    AND p.archived_at IS NULL
    AND (
      SELECT count(*)
      FROM sessions x
      WHERE x.period_id = p.id
        AND x.archived_at IS NULL
        AND x.canceled_at IS NULL
    ) < period_size()
  ORDER BY p.seq DESC
  LIMIT 1;

  IF v_period IS NULL THEN
    INSERT INTO periods (assignment_id, seq)
    VALUES (
      v_assignment,
      (
        SELECT COALESCE(max(seq), 0) + 1
        FROM periods
        WHERE assignment_id = v_assignment
      )
    )
    RETURNING id INTO v_period;
  END IF;

  UPDATE sessions
  SET period_id = v_period
  WHERE id = p_session;
END;
$$;

CREATE FUNCTION detach_session_if_unscored(p_session uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE sessions s
  SET period_id = NULL
  WHERE s.id = p_session
    AND s.period_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM evaluations e
      WHERE e.session_id = p_session
        AND e.archived_at IS NULL
        AND evaluation_is_answered(
          e.quality_value,
          e.quantity_value,
          e.quality_comment,
          e.quantity_comment
        )
    );
END;
$$;

-- Migration 034 deliberately blocked both canceling and archiving when cells
-- existed. Schema 4 only blocks cancellation; archiving is historical and
-- detaches the session while retaining its cells.
DROP TRIGGER sessions_inactive_guard_trg ON sessions;
DROP FUNCTION sessions_inactive_guard();

CREATE FUNCTION sessions_cancel_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.canceled_at IS NOT NULL
     AND OLD.canceled_at IS NULL
     AND EXISTS (
       SELECT 1
       FROM evaluations
       WHERE session_id = OLD.id
         AND archived_at IS NULL
     ) THEN
    RAISE EXCEPTION 'session has active evaluation cells'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sessions_cancel_guard_trg
  BEFORE UPDATE OF canceled_at ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_cancel_guard();

CREATE FUNCTION sessions_period_activity_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.archived_at IS NOT NULL OR NEW.canceled_at IS NOT NULL)
     AND OLD.archived_at IS NULL
     AND OLD.canceled_at IS NULL THEN
    NEW.period_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sessions_period_activity_guard_trg
  BEFORE UPDATE OF archived_at, canceled_at ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_period_activity_guard();

CREATE FUNCTION sessions_period_reactivate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.archived_at IS NULL
     AND NEW.canceled_at IS NULL
     AND (OLD.archived_at IS NOT NULL OR OLD.canceled_at IS NOT NULL)
     AND NEW.period_id IS NULL
     AND EXISTS (
       SELECT 1
       FROM evaluations e
       WHERE e.session_id = NEW.id
         AND e.archived_at IS NULL
         AND evaluation_is_answered(
           e.quality_value,
           e.quantity_value,
           e.quality_comment,
           e.quantity_comment
         )
     ) THEN
    PERFORM attach_session_to_period(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER sessions_period_reactivate_trg
  AFTER UPDATE OF archived_at, canceled_at ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_period_reactivate();

-- Match schema 4's archived-parameter behavior: paused cells do not block a
-- session, but historical answered cells still make it complete when every
-- selected cell is currently paused.
CREATE OR REPLACE FUNCTION session_is_complete(p_session uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  WITH cells AS (
    SELECT e.quality_value,
           e.quantity_value,
           e.quality_comment,
           e.quantity_comment
    FROM evaluations e
    JOIN parameters p
      ON p.id = e.parameter_id
     AND p.archived_at IS NULL
    WHERE e.session_id = p_session
      AND e.archived_at IS NULL
  )
  SELECT (
    EXISTS (SELECT 1 FROM cells)
    AND NOT EXISTS (
      SELECT 1
      FROM cells
      WHERE NOT evaluation_is_answered(
        quality_value,
        quantity_value,
        quality_comment,
        quantity_comment
      )
    )
  ) OR (
    NOT EXISTS (SELECT 1 FROM cells)
    AND EXISTS (
      SELECT 1
      FROM evaluations e
      WHERE e.session_id = p_session
        AND e.archived_at IS NULL
        AND evaluation_is_answered(
          e.quality_value,
          e.quantity_value,
          e.quality_comment,
          e.quantity_comment
        )
    )
  )
$$;

-- Evaluation changes and the scanner take the same transaction-scoped lock,
-- preventing a newly completed session from racing with an alert insert.
CREATE FUNCTION resolve_session_alerts(p_session uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_resolved integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session::text, 0));
  UPDATE alerts a
  SET resolved_at = now()
  WHERE a.session_id = p_session
    AND a.kind = 'session_unconfirmed'
    AND a.resolved_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM sessions s
      WHERE s.id = p_session
        AND (
          s.archived_at IS NOT NULL
          OR s.canceled_at IS NOT NULL
          OR session_is_complete(p_session)
        )
    );
  GET DIAGNOSTICS v_resolved = ROW_COUNT;
  RETURN v_resolved;
END;
$$;

CREATE FUNCTION evaluations_after_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.archived_at IS NULL
       AND evaluation_is_answered(
         NEW.quality_value,
         NEW.quantity_value,
         NEW.quality_comment,
         NEW.quantity_comment
       ) THEN
      PERFORM attach_session_to_period(NEW.session_id);
    END IF;
    PERFORM resolve_session_alerts(NEW.session_id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.archived_at IS NULL
       AND evaluation_is_answered(
         NEW.quality_value,
         NEW.quantity_value,
         NEW.quality_comment,
         NEW.quantity_comment
       ) THEN
      PERFORM attach_session_to_period(NEW.session_id);
    END IF;

    PERFORM detach_session_if_unscored(NEW.session_id);

    IF NEW.session_id IS DISTINCT FROM OLD.session_id THEN
      PERFORM detach_session_if_unscored(OLD.session_id);
      PERFORM resolve_session_alerts(OLD.session_id);
    END IF;

    PERFORM resolve_session_alerts(NEW.session_id);
  ELSE
    PERFORM detach_session_if_unscored(OLD.session_id);
    PERFORM resolve_session_alerts(OLD.session_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER evaluations_alert_period_trg
  AFTER INSERT OR UPDATE OR DELETE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION evaluations_after_change();

CREATE FUNCTION sessions_alert_activity_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM resolve_session_alerts(NEW.id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER sessions_alert_activity_sync_trg
  AFTER UPDATE OF archived_at, canceled_at ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_alert_activity_sync();

CREATE VIEW session_status AS
SELECT s.id AS session_id,
       s.assignment_id,
       s.code,
       s.session_date,
       CASE
         WHEN s.canceled_at IS NOT NULL THEN 'canceled'
         WHEN session_is_complete(s.id) THEN 'complete'
         WHEN EXISTS (
           SELECT 1
           FROM evaluations e
           WHERE e.session_id = s.id
             AND e.archived_at IS NULL
             AND evaluation_is_answered(
               e.quality_value,
               e.quantity_value,
               e.quality_comment,
               e.quantity_comment
             )
         ) THEN 'partial'
         WHEN s.session_date >= current_date THEN 'upcoming'
         ELSE 'not_attended'
       END AS status
FROM sessions s
WHERE s.archived_at IS NULL;

CREATE VIEW period_summary AS
SELECT p.id AS period_id,
       p.assignment_id,
       p.seq,
       count(s.id) AS sessions_count,
       count(s.id) >= period_size() AS is_complete,
       min(s.session_date) AS started_on,
       max(s.session_date) AS ended_on
FROM periods p
LEFT JOIN sessions s
  ON s.period_id = p.id
 AND s.archived_at IS NULL
 AND s.canceled_at IS NULL
WHERE p.archived_at IS NULL
GROUP BY p.id, p.assignment_id, p.seq;

CREATE OR REPLACE VIEW session_missing_parameters AS
SELECT e.session_id,
       e.parameter_id,
       e.membership_id
FROM evaluations e
JOIN sessions s ON s.id = e.session_id
JOIN parameters p
  ON p.id = e.parameter_id
 AND p.archived_at IS NULL
WHERE s.archived_at IS NULL
  AND s.canceled_at IS NULL
  AND e.archived_at IS NULL
  AND NOT evaluation_is_answered(
    e.quality_value,
    e.quantity_value,
    e.quality_comment,
    e.quantity_comment
  );

CREATE VIEW period_analysis AS
SELECT s.period_id,
       s.assignment_id,
       e.parameter_id,
       e.membership_id,
       count(DISTINCT e.session_id) AS sessions_evaluated,
       round(avg(e.quality_value), 2) AS avg_quality,
       round(avg(e.quantity_value), 2) AS avg_quantity
FROM evaluations e
JOIN sessions s ON s.id = e.session_id
JOIN periods p
  ON p.id = s.period_id
 AND p.archived_at IS NULL
WHERE e.archived_at IS NULL
  AND evaluation_is_answered(
    e.quality_value,
    e.quantity_value,
    e.quality_comment,
    e.quantity_comment
  )
  AND s.archived_at IS NULL
  AND s.canceled_at IS NULL
  AND s.period_id IS NOT NULL
GROUP BY s.period_id, s.assignment_id, e.parameter_id, e.membership_id;
