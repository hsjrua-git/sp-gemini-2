-- Student identity columns, temporal group memberships, and schema hygiene,
-- adopted from the schema-4 reference design (helpful/schema-4.sql).
--
-- Identity columns are added NULLABLE so the existing rows stay valid; the
-- forms collect them and later data can be tightened. national_id is unique
-- among filled values (multiple NULLs are allowed).
--
-- Memberships become temporal: student_group_members keeps its history and
-- gains left_on; an open membership is a row with left_on IS NULL, and only
-- one open membership per (student, group) may exist. Removing a member now
-- sets left_on instead of deleting the row, so re-joins keep their history.

CREATE TYPE gender_type AS ENUM ('male', 'female');

ALTER TABLE students
  ADD COLUMN gender gender_type,
  ADD COLUMN birth_date date,
  ADD COLUMN father_name text,
  ADD COLUMN national_id text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE students
  ADD CONSTRAINT students_father_name_length
    CHECK (father_name IS NULL OR char_length(btrim(father_name)) BETWEEN 1 AND 100),
  ADD CONSTRAINT students_national_id_format
    CHECK (national_id IS NULL OR national_id ~ '^[0-9]{10}$'),
  ADD CONSTRAINT students_birth_date_sane
    CHECK (birth_date IS NULL OR birth_date <= current_date);

CREATE UNIQUE INDEX students_national_id_unique ON students (national_id);

-- Parameters gain an optional parent for grouping (schema-4's parameter tree)
-- and a DB-level range check the app already enforced on its own.
ALTER TABLE parameters
  ADD COLUMN parent_id uuid REFERENCES parameters(id),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE parameters
  ADD CONSTRAINT parameters_range_ck CHECK (min_value <= max_value);

CREATE INDEX parameters_parent_idx ON parameters (parent_id);

ALTER TABLE student_groups
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE student_field_definitions
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE roles
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Temporal memberships: replace the composite primary key with a row id so a
-- student can leave and re-join a group, and add left_on. The partial unique
-- index keeps a single OPEN membership per (student, group).
ALTER TABLE student_group_members
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN left_on date;

ALTER TABLE student_group_members
  DROP CONSTRAINT student_group_members_pkey;

ALTER TABLE student_group_members
  ADD CONSTRAINT student_group_members_pkey PRIMARY KEY (id),
  ADD CONSTRAINT student_group_members_dates_ck
    CHECK (left_on IS NULL OR left_on >= added_at::date);

CREATE UNIQUE INDEX student_group_members_open_unique
  ON student_group_members (student_id, group_id)
  WHERE left_on IS NULL;

-- Keep updated_at current on every table that has one, from now on in the
-- database rather than in each query (schema-4's set_updated_at).
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER parameters_updated_at
  BEFORE UPDATE ON parameters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER student_groups_updated_at
  BEFORE UPDATE ON student_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER student_field_definitions_updated_at
  BEFORE UPDATE ON student_field_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER roles_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER student_group_members_updated_at
  BEFORE UPDATE ON student_group_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER evaluations_updated_at
  BEFORE UPDATE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER saved_views_updated_at
  BEFORE UPDATE ON saved_views
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
