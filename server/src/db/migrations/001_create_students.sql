CREATE TABLE students (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_code text NOT NULL UNIQUE,
  full_name    text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CONSTRAINT student_code_format
    CHECK (student_code ~ '^[2-9A-HJ-NP-Z]{8}$'),
  CONSTRAINT full_name_length
    CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 100)
);