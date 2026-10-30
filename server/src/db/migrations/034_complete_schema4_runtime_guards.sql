-- Complete the applicable runtime guarantees from the maintainer's schema-4
-- reference, adapted to this app's deliberate model changes:
--   * plural table names and per-user preferences / application audit log
--   * parameter/group stable codes
--   * quality + quantity each have their own comment
--   * locks_at is a deadline (rather than an instant locked_at flag)
--   * periods remain deterministic four-active-session assignment buckets

CREATE OR REPLACE FUNCTION evaluation_is_answered(
  p_quality integer,
  p_quantity integer,
  p_quality_comment text,
  p_quantity_comment text
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_quality IS NOT NULL
      OR p_quantity IS NOT NULL
      OR NULLIF(btrim(COALESCE(p_quality_comment, '')), '') IS NOT NULL
      OR NULLIF(btrim(COALESCE(p_quantity_comment, '')), '') IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION session_is_complete(p_session uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  WITH cells AS (
    SELECT e.quality_value, e.quantity_value,
           e.quality_comment, e.quantity_comment
    FROM evaluations e
    JOIN parameters p ON p.id = e.parameter_id AND p.archived_at IS NULL
    WHERE e.session_id = p_session AND e.archived_at IS NULL
  )
  SELECT EXISTS (SELECT 1 FROM cells)
     AND NOT EXISTS (
       SELECT 1 FROM cells
       WHERE NOT evaluation_is_answered(
         quality_value, quantity_value, quality_comment, quantity_comment
       )
     )
$$;

CREATE FUNCTION evaluations_schema4_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_assignment_id uuid;
  v_group_id uuid;
  v_assignment_membership uuid;
  v_session_date date;
  v_session_archived timestamptz;
  v_session_canceled timestamptz;
  v_assignment_archived timestamptz;
  v_parameter_archived timestamptz;
  v_membership record;
BEGIN
  -- Archiving is allowed so history can be retained. Restoring/editing is
  -- checked against all live references below.
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.assignment_id, s.session_date, s.archived_at, s.canceled_at,
         a.group_id, a.membership_id, a.archived_at, p.archived_at
    INTO v_assignment_id, v_session_date, v_session_archived,
         v_session_canceled, v_group_id, v_assignment_membership,
         v_assignment_archived, v_parameter_archived
  FROM sessions s
  JOIN assignments a ON a.id = s.assignment_id
  JOIN parameters p ON p.id = NEW.parameter_id
  WHERE s.id = NEW.session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'evaluation references a missing session, assignment, or parameter'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_session_archived IS NOT NULL OR v_session_canceled IS NOT NULL THEN
    RAISE EXCEPTION 'an archived or canceled session cannot be evaluated'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_assignment_archived IS NOT NULL THEN
    RAISE EXCEPTION 'an archived assignment cannot be evaluated'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_parameter_archived IS NOT NULL THEN
    RAISE EXCEPTION 'an archived parameter cannot be evaluated'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_group_id IS NOT NULL THEN
    IF NEW.membership_id IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM student_groups
        WHERE id = v_group_id AND archived_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'an archived group cannot be evaluated'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
    SELECT m.group_id, m.added_at::date AS joined_on, m.left_on,
           s.deleted_at, g.archived_at
      INTO v_membership
    FROM student_group_members m
    JOIN students s ON s.id = m.student_id
    JOIN student_groups g ON g.id = m.group_id
    WHERE m.id = NEW.membership_id AND m.group_id = v_group_id;
  ELSE
    IF NEW.membership_id IS NULL OR NEW.membership_id <> v_assignment_membership THEN
      RAISE EXCEPTION 'an individual assignment requires its own member target'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT m.group_id, m.added_at::date AS joined_on, m.left_on,
           s.deleted_at, g.archived_at
      INTO v_membership
    FROM student_group_members m
    JOIN students s ON s.id = m.student_id
    JOIN student_groups g ON g.id = m.group_id
    WHERE m.id = NEW.membership_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership does not belong to the assignment target'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_membership.deleted_at IS NOT NULL OR v_membership.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'membership points at an inactive student or group'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_session_date < v_membership.joined_on
     OR (v_membership.left_on IS NOT NULL AND v_session_date > v_membership.left_on) THEN
    RAISE EXCEPTION 'membership was not active on the session date'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evaluations_schema4_guard_trg
  BEFORE INSERT OR UPDATE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION evaluations_schema4_guard();

CREATE FUNCTION evaluations_archived_edit_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_changed boolean;
BEGIN
  v_changed := (to_jsonb(NEW) - 'updated_at' - 'archived_at')
            IS DISTINCT FROM
               (to_jsonb(OLD) - 'updated_at' - 'archived_at');
  IF NOT v_changed THEN RETURN NEW; END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'an archived evaluation must be restored before editing'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'an evaluation cannot be edited while being archived'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evaluations_archived_edit_guard_trg
  BEFORE UPDATE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION evaluations_archived_edit_guard();

CREATE FUNCTION evaluations_lock_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_reason text;
  v_changed boolean;
BEGIN
  IF OLD.locks_at > now() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_changed := true;
  ELSE
    v_changed := NEW.session_id IS DISTINCT FROM OLD.session_id
      OR NEW.parameter_id IS DISTINCT FROM OLD.parameter_id
      OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
      OR NEW.quality_value IS DISTINCT FROM OLD.quality_value
      OR NEW.quantity_value IS DISTINCT FROM OLD.quantity_value
      OR NEW.quality_comment IS DISTINCT FROM OLD.quality_comment
      OR NEW.quantity_comment IS DISTINCT FROM OLD.quantity_comment;
  END IF;
  IF v_changed THEN
    v_reason := NULLIF(
      btrim(COALESCE(current_setting('app.override_reason', true), '')),
      ''
    );
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'locked evaluation requires app.override_reason'
        USING ERRCODE = 'check_violation';
    END IF;
    IF char_length(v_reason) > 500 THEN
      RAISE EXCEPTION 'override reason is too long (max 500)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evaluations_lock_guard_trg
  BEFORE UPDATE OR DELETE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION evaluations_lock_guard();

CREATE FUNCTION sessions_inactive_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.canceled_at IS NOT NULL OR NEW.archived_at IS NOT NULL)
     AND OLD.canceled_at IS NULL AND OLD.archived_at IS NULL
     AND EXISTS (
       SELECT 1 FROM evaluations
       WHERE session_id = OLD.id AND archived_at IS NULL
     ) THEN
    RAISE EXCEPTION 'session has active evaluation cells'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sessions_inactive_guard_trg
  BEFORE UPDATE OF canceled_at, archived_at ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_inactive_guard();

CREATE FUNCTION sessions_set_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_assignment_code text;
BEGIN
  PERFORM 1 FROM assignments WHERE id = NEW.assignment_id FOR NO KEY UPDATE;
  SELECT code INTO v_assignment_code FROM assignments WHERE id = NEW.assignment_id;
  IF v_assignment_code IS NULL THEN
    RAISE EXCEPTION 'assignment does not exist'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.seq IS NULL THEN
    SELECT COALESCE(max(seq), 0) + 1 INTO NEW.seq
    FROM sessions WHERE assignment_id = NEW.assignment_id;
  END IF;
  NEW.code := v_assignment_code || '-' ||
    CASE WHEN NEW.seq < 1000
      THEN lpad(NEW.seq::text, 3, '0')
      ELSE NEW.seq::text
    END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sessions_set_identity_trg
  BEFORE INSERT ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_set_identity();

CREATE FUNCTION sessions_identity_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
     OR NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.planned_date IS DISTINCT FROM OLD.planned_date THEN
    RAISE EXCEPTION 'session identity and planned date are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sessions_identity_guard_trg
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_identity_guard();

CREATE FUNCTION assignments_code_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code
     AND EXISTS (SELECT 1 FROM sessions WHERE assignment_id = OLD.id) THEN
    RAISE EXCEPTION 'assignment code cannot change after sessions exist'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assignments_code_guard_trg
  BEFORE UPDATE OF code ON assignments
  FOR EACH ROW EXECUTE FUNCTION assignments_code_guard();

CREATE FUNCTION tasks_schema4_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_group_id uuid;
  v_assignment_membership uuid;
  v_session_date date;
  v_membership record;
BEGIN
  SELECT a.group_id, a.membership_id, s.session_date
    INTO v_group_id, v_assignment_membership, v_session_date
  FROM sessions s
  JOIN assignments a ON a.id = s.assignment_id
  WHERE s.id = NEW.session_id
    AND s.archived_at IS NULL AND s.canceled_at IS NULL
    AND a.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task session or assignment is inactive'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.parameter_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM parameters
    WHERE id = NEW.parameter_id AND archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'task parameter is archived'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.membership_id IS NULL THEN RETURN NEW; END IF;

  SELECT m.group_id, m.added_at::date AS joined_on, m.left_on,
         st.deleted_at, g.archived_at
    INTO v_membership
  FROM student_group_members m
  JOIN students st ON st.id = m.student_id
  JOIN student_groups g ON g.id = m.group_id
  WHERE m.id = NEW.membership_id;
  IF NOT FOUND
     OR v_membership.deleted_at IS NOT NULL
     OR v_membership.archived_at IS NOT NULL
     OR v_session_date < v_membership.joined_on
     OR (v_membership.left_on IS NOT NULL AND v_session_date > v_membership.left_on)
     OR (v_group_id IS NOT NULL AND v_membership.group_id <> v_group_id)
     OR (v_group_id IS NULL AND NEW.membership_id <> v_assignment_membership) THEN
    RAISE EXCEPTION 'task membership is not active for the assignment session'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_schema4_guard_trg
  BEFORE INSERT OR UPDATE OF session_id, parameter_id, membership_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_schema4_guard();

CREATE UNIQUE INDEX student_group_members_history_unique
  ON student_group_members (student_id, group_id, added_at);

CREATE INDEX tasks_session_parameter_membership_idx
  ON tasks (session_id, parameter_id, membership_id);

CREATE VIEW session_missing_parameters AS
SELECT e.session_id, e.parameter_id, e.membership_id
FROM evaluations e
JOIN sessions s ON s.id = e.session_id
JOIN parameters p ON p.id = e.parameter_id AND p.archived_at IS NULL
WHERE s.archived_at IS NULL
  AND s.canceled_at IS NULL
  AND e.archived_at IS NULL
  AND NOT evaluation_is_answered(
    e.quality_value, e.quantity_value,
    e.quality_comment, e.quantity_comment
  );
