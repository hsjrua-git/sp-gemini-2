-- Definitions are copied into each assignment; progress never lives in a template.
ALTER TABLE task_templates ADD COLUMN checklist jsonb NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN checklist jsonb NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN note text;
ALTER TABLE tasks ADD CONSTRAINT tasks_note_ck CHECK (char_length(note) <= 2000);

CREATE FUNCTION valid_task_checklist(items jsonb, progress boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; seen text[] := '{}';
BEGIN
  IF jsonb_typeof(items) <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(items) > 50 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    IF jsonb_typeof(item) <> 'object'
       OR NOT (item ? 'id' AND item ? 'label')
       OR jsonb_typeof(item->'id') <> 'string'
       OR (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR item->>'id' = ANY(seen)
       OR jsonb_typeof(item->'label') <> 'string'
       OR char_length(btrim(item->>'label')) NOT BETWEEN 1 AND 200 THEN RETURN false; END IF;
    seen := array_append(seen, item->>'id');
    IF progress THEN
      IF NOT (item ? 'done' AND item ? 'doneAt' AND item ? 'note')
         OR jsonb_typeof(item->'done') <> 'boolean'
         OR (item->>'done')::boolean <> (jsonb_typeof(item->'doneAt') = 'string')
         OR jsonb_typeof(item->'doneAt') NOT IN ('string', 'null')
         OR jsonb_typeof(item->'note') NOT IN ('string', 'null')
         OR char_length(item->>'note') > 2000 THEN RETURN false; END IF;
      IF item->>'doneAt' IS NOT NULL THEN PERFORM (item->>'doneAt')::timestamptz; END IF;
    ELSIF item ? 'done' OR item ? 'doneAt' OR item ? 'note' THEN RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;

ALTER TABLE task_templates ADD CONSTRAINT task_templates_checklist_ck
  CHECK (valid_task_checklist(checklist, false));
ALTER TABLE tasks ADD CONSTRAINT tasks_checklist_ck
  CHECK (valid_task_checklist(checklist, true));
ALTER TABLE tasks ADD CONSTRAINT tasks_checklist_done_ck CHECK (
  jsonb_array_length(checklist) = 0 OR
  (done = NOT jsonb_path_exists(checklist, '$[*] ? (@.done == false)')
   AND done = (done_at IS NOT NULL))
);
