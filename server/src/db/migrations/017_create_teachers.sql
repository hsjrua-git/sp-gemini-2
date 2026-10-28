-- Teachers, from the schema-4 reference design. A teacher is required with
-- full identity from the start (the table is new, so the columns can be
-- NOT NULL unlike the gradually-filled student columns). Archiving replaces
-- deleting, exactly like students and groups.

CREATE TABLE teachers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  full_name   text NOT NULL,
  birth_date  date NOT NULL,
  national_id text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT teachers_full_name_length
    CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 100),
  CONSTRAINT teachers_national_id_format
    CHECK (national_id ~ '^[0-9]{10}$'),
  CONSTRAINT teachers_birth_date_sane
    CHECK (birth_date <= current_date)
);

CREATE UNIQUE INDEX teachers_code_unique ON teachers (code);
CREATE UNIQUE INDEX teachers_national_id_unique ON teachers (national_id);

CREATE TRIGGER teachers_updated_at
  BEFORE UPDATE ON teachers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The Administrator role gains the new keys; other roles get nothing new.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, key
FROM roles r
CROSS JOIN (VALUES
  ('teachers.view'),
  ('teachers.manage')
) AS keys(key)
WHERE lower(r.name) = 'administrator'
ON CONFLICT DO NOTHING;
