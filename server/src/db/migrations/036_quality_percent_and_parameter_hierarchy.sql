-- Quality is an absolute percentage; parameter bounds describe quantity only.
-- Existing values retain their meaning. The workflow fixture is seeded fresh;
-- incompatible legacy values cause adoption to fail rather than silently round.
ALTER TABLE evaluations ADD CONSTRAINT evaluations_quality_percent_ck
  CHECK (quality_value IS NULL OR quality_value BETWEEN 0 AND 100);

CREATE OR REPLACE FUNCTION check_evaluation_range() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_min integer;
  v_max integer;
BEGIN
  SELECT min_value, max_value INTO v_min, v_max
    FROM parameters WHERE id = NEW.parameter_id FOR SHARE;
  IF NEW.quality_value IS NOT NULL AND NEW.quality_value NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'quality must be between 0 and 100 percent'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'evaluations_quality_percent_ck';
  END IF;
  IF NEW.quantity_value IS NOT NULL AND (
       (v_min IS NOT NULL AND NEW.quantity_value < v_min) OR
       (v_max IS NOT NULL AND NEW.quantity_value > v_max)) THEN
    RAISE EXCEPTION 'quantity is outside the parameter range'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_parameter_range_narrowing() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM evaluations e
    WHERE e.parameter_id = NEW.id AND e.archived_at IS NULL
      AND ((NEW.min_value IS NOT NULL AND e.quantity_value < NEW.min_value)
        OR (NEW.max_value IS NOT NULL AND e.quantity_value > NEW.max_value))
  ) THEN
    RAISE EXCEPTION 'parameter has quantities outside the new range'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'parameters_quantity_range_locked';
  END IF;
  RETURN NEW;
END $$;

INSERT INTO hierarchy_invariant_locks (key) VALUES ('parameters');

CREATE FUNCTION parameters_hierarchy_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM hierarchy_invariant_locks WHERE key = 'parameters' FOR UPDATE;
  IF NEW.parent_id = NEW.id OR (NEW.parent_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM parameters WHERE id = NEW.parent_id
      UNION
      SELECT p.id, p.parent_id FROM parameters p JOIN ancestors a ON p.id = a.parent_id
    ) SELECT 1 FROM ancestors WHERE id = NEW.id
  )) THEN
    RAISE EXCEPTION 'parameter hierarchy cannot contain a cycle'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'parameters_hierarchy_cycle';
  END IF;
  IF NEW.archived_at IS NULL AND EXISTS (
    SELECT 1 FROM parameters WHERE id = NEW.parent_id AND archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'choose an active parent parameter'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'parameters_hierarchy_active';
  END IF;
  IF NEW.archived_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM parameters WHERE parent_id = NEW.id AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'archive or move the active children first'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'parameters_hierarchy_active';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER parameters_hierarchy_guard_trg
  BEFORE INSERT OR UPDATE OF parent_id, archived_at ON parameters
  FOR EACH ROW EXECUTE FUNCTION parameters_hierarchy_guard();
