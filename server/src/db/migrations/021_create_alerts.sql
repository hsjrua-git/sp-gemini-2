-- Alerts, from the schema-4 reference design (adapted to the additive
-- scheduling model). An alert is operational, not a workflow state: today the
-- only kind is session_unconfirmed — a session whose date has passed with no
-- record at all (not canceled, no note, no tasks). New kinds can be added to
-- the CHECK and raised by the same endpoint later.
--
-- One OPEN alert per kind/session (partial unique index), so a resolved alert
-- can be raised again if the problem returns. Alerts are never archived;
-- resolving or deleting is enough, and the audit log keeps the history.

CREATE TABLE alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,
  session_id  uuid REFERENCES sessions(id) ON DELETE CASCADE,
  message     text,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alerts_kind_ck CHECK (kind IN ('session_unconfirmed'))
);

CREATE INDEX alerts_session_idx ON alerts (session_id);

CREATE UNIQUE INDEX alerts_open_unique
  ON alerts (kind, session_id)
  WHERE session_id IS NOT NULL AND resolved_at IS NULL;

CREATE TRIGGER alerts_updated_at
  BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
