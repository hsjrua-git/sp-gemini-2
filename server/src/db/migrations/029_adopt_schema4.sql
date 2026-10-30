-- Adopt the schema-4 evaluation model (the maintainer's richer reference
-- design, student_panel DB — the newer two-comment revision). Evaluations
-- stop being "one numeric value per student × parameter × weekly period" and
-- become "one selected cell per session × parameter × target (a member, or
-- the whole group)", carrying TWO ranged integers: quality_value (کیفیت — how
-- well) and quantity_value (کمیت — how much), each with its own comment.
-- A row may exist before any value is entered: "selected, not answered yet" —
-- the row itself is the expectation the dashboard counts.
--
-- Periods become stored rows per assignment (every four non-canceled sessions
-- of an assignment form one period, seq 1, 2, 3…) instead of a global 7-day
-- calendar derived from the period_anchor_date setting; the parameter_changes
-- log dies with it (which parameters apply is now the evaluator's explicit
-- cell selection, session by session).
--
-- Data policy (approved): the schema change makes old evaluation/period data
-- meaningless, so rows are dropped here; `npm run reset-data -- confirm` +
-- the rewritten seed then produce a clean new-model dataset. Students, staff,
-- sessions and the cafe/accounting ledgers are NOT touched by this migration.

-- ------------------------------------------------------------------ teardown
DROP TABLE IF EXISTS parameter_changes;
DROP TABLE IF EXISTS evaluations;
DELETE FROM saved_views;                       -- configs encode the old model
DELETE FROM settings WHERE key = 'period_anchor_date';

-- ------------------------------------------------------------------ periods
-- One period row per (assignment, seq). No dates: a period's span is derived
-- from its member sessions at query time.
CREATE TABLE periods (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments (id),
  seq           integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  CONSTRAINT period_seq_positive CHECK (seq >= 1)
);
CREATE UNIQUE INDEX periods_assignment_seq_unique ON periods (assignment_id, seq);
CREATE INDEX periods_assignment_idx ON periods (assignment_id);
CREATE TRIGGER periods_set_updated_at BEFORE UPDATE ON periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------------------------------------------- parameters
-- Code (stable short identifier from the reference DB) replaces unit;
-- min/max become integers (quality/quantity are integers).
ALTER TABLE parameters ADD COLUMN code text;
UPDATE parameters SET code = 'p-' || substr(id::text, 1, 8);
ALTER TABLE parameters ALTER COLUMN code SET NOT NULL;
ALTER TABLE parameters DROP COLUMN unit;
ALTER TABLE parameters ALTER COLUMN min_value TYPE integer USING round(min_value)::int;
ALTER TABLE parameters ALTER COLUMN max_value TYPE integer USING round(max_value)::int;
ALTER TABLE parameters ADD COLUMN archived_at timestamptz;
ALTER TABLE parameters ADD CONSTRAINT parameter_code_ck
  CHECK (char_length(btrim(code)) BETWEEN 1 AND 40);
DROP INDEX parameters_name_unique;
CREATE UNIQUE INDEX parameters_code_unique ON parameters (code);
CREATE UNIQUE INDEX parameters_parent_name_unique
  ON parameters (parent_id, name) NULLS NOT DISTINCT;
CREATE TRIGGER parameters_set_updated_at BEFORE UPDATE ON parameters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -------------------------------------------------------- group ordering pack
ALTER TABLE student_groups ADD COLUMN code text;
UPDATE student_groups SET code = 'g-' || substr(id::text, 1, 8);
ALTER TABLE student_groups ALTER COLUMN code SET NOT NULL;
ALTER TABLE student_groups ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE student_groups ADD CONSTRAINT group_code_ck
  CHECK (char_length(btrim(code)) BETWEEN 1 AND 40);
ALTER TABLE student_groups ADD CONSTRAINT group_sort_ck CHECK (sort_order >= 0);
CREATE UNIQUE INDEX student_groups_code_unique ON student_groups (code);
CREATE TRIGGER student_groups_set_updated_at BEFORE UPDATE ON student_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -------------------------------------------------------- assignment ordering
ALTER TABLE assignments ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE assignments ADD CONSTRAINT assignments_sort_ck CHECK (sort_order >= 0);

-- ------------------------------------------------------------- task targeting
ALTER TABLE task_templates ADD COLUMN parameter_id uuid REFERENCES parameters (id);
ALTER TABLE task_templates ADD COLUMN extra jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE task_templates ADD CONSTRAINT task_templates_extra_ck
  CHECK (jsonb_typeof(extra) = 'object');
CREATE INDEX task_templates_parameter_idx ON task_templates (parameter_id);

ALTER TABLE tasks ADD COLUMN parameter_id uuid REFERENCES parameters (id);
ALTER TABLE tasks ADD COLUMN membership_id uuid REFERENCES student_group_members (id);
ALTER TABLE tasks ADD COLUMN extra jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tasks ADD CONSTRAINT tasks_extra_ck CHECK (jsonb_typeof(extra) = 'object');
CREATE INDEX tasks_parameter_idx ON tasks (parameter_id);
CREATE INDEX tasks_membership_idx ON tasks (membership_id);

-- --------------------------------------------------------------- evaluations
-- locks_at keeps today's semantics (the deadline after which changes need an
-- override) rather than the reference's instant locked_at: the auto-lock
-- window is computed from the session's effective date (7 days while the
-- session is current, 1 day once it is past) and re-anchored on moves.
CREATE TABLE evaluations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES sessions (id),
  parameter_id     uuid NOT NULL REFERENCES parameters (id),
  membership_id    uuid REFERENCES student_group_members (id),  -- null = whole group
  quality_value    integer,
  quantity_value   integer,
  quality_comment  text,
  quantity_comment text,
  locks_at         timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  CONSTRAINT evaluation_quality_comment_ck
    CHECK (quality_comment IS NULL OR char_length(quality_comment) <= 500),
  CONSTRAINT evaluation_quantity_comment_ck
    CHECK (quantity_comment IS NULL OR char_length(quantity_comment) <= 500)
);

-- One evaluation per session/parameter/target; NULL membership = the whole
-- group (NULLS NOT DISTINCT so a group row and member rows coexist).
CREATE UNIQUE INDEX evaluations_cell_unique
  ON evaluations (session_id, parameter_id, membership_id) NULLS NOT DISTINCT;
CREATE INDEX evaluations_parameter_idx ON evaluations (parameter_id);
CREATE INDEX evaluations_membership_idx ON evaluations (membership_id);
CREATE INDEX evaluations_session_idx ON evaluations (session_id);
CREATE TRIGGER evaluations_set_updated_at BEFORE UPDATE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Both values must sit inside the parameter's own [min, max] range (NULL
-- bounds = unbounded on that side), and narrowing a parameter's range must
-- not invalidate existing answers (schema-4's check_parameter_range family,
-- adapted to the two-value row).
CREATE FUNCTION check_evaluation_range() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_min integer;
  v_max integer;
BEGIN
  SELECT min_value, max_value INTO v_min, v_max
    FROM parameters WHERE id = NEW.parameter_id;

  IF NEW.quality_value IS NOT NULL AND (
       (v_min IS NOT NULL AND NEW.quality_value < v_min) OR
       (v_max IS NOT NULL AND NEW.quality_value > v_max)) THEN
    RAISE EXCEPTION 'quality value % is outside parameter % range [%, %]',
      NEW.quality_value, NEW.parameter_id, COALESCE(v_min::text, '-inf'),
      COALESCE(v_max::text, '+inf')
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.quantity_value IS NOT NULL AND (
       (v_min IS NOT NULL AND NEW.quantity_value < v_min) OR
       (v_max IS NOT NULL AND NEW.quantity_value > v_max)) THEN
    RAISE EXCEPTION 'quantity value % is outside parameter % range [%, %]',
      NEW.quantity_value, NEW.parameter_id, COALESCE(v_min::text, '-inf'),
      COALESCE(v_max::text, '+inf')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER evaluations_range_ck
  BEFORE INSERT OR UPDATE OF parameter_id, quality_value, quantity_value ON evaluations
  FOR EACH ROW EXECUTE FUNCTION check_evaluation_range();

CREATE FUNCTION check_parameter_range_narrowing() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM evaluations e
     WHERE e.parameter_id = NEW.id
       AND e.archived_at IS NULL
       AND (
         (e.quality_value IS NOT NULL AND (
            (NEW.min_value IS NOT NULL AND e.quality_value < NEW.min_value) OR
            (NEW.max_value IS NOT NULL AND e.quality_value > NEW.max_value)))
         OR
         (e.quantity_value IS NOT NULL AND (
            (NEW.min_value IS NOT NULL AND e.quantity_value < NEW.min_value) OR
            (NEW.max_value IS NOT NULL AND e.quantity_value > NEW.max_value)))
       )
  ) THEN
    RAISE EXCEPTION 'parameter % has evaluations outside the new range', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER parameters_range_narrowing_ck
  BEFORE UPDATE OF min_value, max_value ON parameters
  FOR EACH ROW EXECUTE FUNCTION check_parameter_range_narrowing();

-- ------------------------------------------------------------ audit snapshots
-- Row snapshots alongside the existing details JSON: old_data = the row
-- before the change (null on insert), new_data = after (null on delete).
ALTER TABLE audit_log ADD COLUMN old_data jsonb;
ALTER TABLE audit_log ADD COLUMN new_data jsonb;

-- ------------------------------------------------------------------ secrets
-- Exactly one of the two value columns is filled: password hashes in
-- value_hash (never plaintext), API keys etc. in value_encrypted (app-side
-- encryption). No UI yet — infrastructure for the agent/kiosk work.
CREATE TABLE secrets (
  key             text PRIMARY KEY,
  value_hash      text,
  value_encrypted bytea,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT secret_key_ck
    CHECK (char_length(btrim(key)) BETWEEN 1 AND 120),
  CONSTRAINT secret_value_ck
    CHECK (num_nonnulls(value_hash, value_encrypted) = 1),
  CONSTRAINT secret_hash_ck
    CHECK (value_hash IS NULL OR char_length(value_hash) > 0),
  CONSTRAINT secret_cipher_ck
    CHECK (value_encrypted IS NULL OR octet_length(value_encrypted) > 0)
);
