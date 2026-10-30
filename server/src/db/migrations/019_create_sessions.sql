-- Sessions: the concrete occurrences generated from assignments (schema-4).
-- planned_date is immutable (anchor + n * interval) so a schedule stays
-- stable; a session that slips moves via moved_to, and session_date is the
-- generated "date it really takes place". Canceling is a flag, never a
-- delete; archiving removes a session from the calendar while keeping code
-- and history reserved.

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id),
  seq           integer NOT NULL,
  code          text NOT NULL,
  planned_date  date NOT NULL,
  moved_to      date,
  session_date  date GENERATED ALWAYS AS (COALESCE(moved_to, planned_date)) STORED,
  canceled_at   timestamptz,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  CONSTRAINT sessions_seq_positive CHECK (seq >= 1),
  CONSTRAINT sessions_code_ck CHECK (char_length(btrim(code)) BETWEEN 1 AND 80),
  CONSTRAINT sessions_note_ck CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE UNIQUE INDEX sessions_code_unique ON sessions (code);
CREATE UNIQUE INDEX sessions_assignment_seq_unique ON sessions (assignment_id, seq);
CREATE UNIQUE INDEX sessions_assignment_planned_unique ON sessions (assignment_id, planned_date);
CREATE INDEX sessions_session_date_idx ON sessions (session_date);

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
