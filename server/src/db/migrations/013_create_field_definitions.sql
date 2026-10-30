-- Admin-defined custom fields for students. Values live in one JSONB column on
-- students, keyed by field id (not label, so a field can be renamed freely).

CREATE TABLE student_field_definitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text NOT NULL,
  field_type  text NOT NULL,
  choices     jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_restricted boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_label_length CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  CONSTRAINT field_type_valid CHECK (
    field_type IN ('text', 'long_text', 'number', 'date', 'yes_no', 'choice')
  )
);

CREATE UNIQUE INDEX student_field_definitions_label_unique
  ON student_field_definitions (lower(label))
  WHERE archived_at IS NULL;

ALTER TABLE students ADD COLUMN extra jsonb NOT NULL DEFAULT '{}'::jsonb;
