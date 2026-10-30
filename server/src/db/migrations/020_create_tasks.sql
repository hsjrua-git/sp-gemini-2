-- Tasks, from the schema-4 reference design (adapted: tasks are session-level
-- here; member/parameter targeting can come later if needed).
--
-- A template is a reusable definition. Assigning it COPIES its fields into
-- one task row per session; later template edits never change existing tasks.
-- A task itself is an editable snapshot — and unlike most tables it is meant
-- to be deleted (the audit log keeps the history), so it has no archived_at.

CREATE TABLE task_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  description  text,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  CONSTRAINT task_templates_title_ck
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT task_templates_description_ck
    CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT task_templates_sort_ck CHECK (sort_order >= 0)
);

CREATE INDEX task_templates_sort_idx ON task_templates (sort_order);

CREATE TRIGGER task_templates_updated_at
  BEFORE UPDATE ON task_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  template_id  uuid REFERENCES task_templates(id) ON DELETE SET NULL,
  title        text NOT NULL,
  description  text,
  done         boolean NOT NULL DEFAULT false,
  done_at      timestamptz,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_title_ck CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT tasks_description_ck
    CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT tasks_done_ck CHECK (done_at IS NULL OR done),
  CONSTRAINT tasks_sort_ck CHECK (sort_order >= 0)
);

CREATE INDEX tasks_session_idx ON tasks (session_id, sort_order);
CREATE INDEX tasks_template_idx ON tasks (template_id);

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
