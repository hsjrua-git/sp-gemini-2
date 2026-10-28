-- Student groups with unlimited subgroup depth. A group's parent is another
-- group (or NULL for a top-level group). Membership is stored as DIRECT links
-- only; a filter by a group includes its descendants, computed at query time.

CREATE TABLE student_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  parent_id  uuid REFERENCES student_groups (id),
  archived_at timestamptz,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT group_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

-- Names are unique among live siblings (top-level groups share one namespace).
CREATE UNIQUE INDEX student_groups_root_name_unique
  ON student_groups (lower(name))
  WHERE parent_id IS NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX student_groups_child_name_unique
  ON student_groups (parent_id, lower(name))
  WHERE parent_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX student_groups_parent_idx ON student_groups (parent_id);

CREATE TABLE student_group_members (
  student_id uuid NOT NULL REFERENCES students (id),
  group_id   uuid NOT NULL REFERENCES student_groups (id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, group_id)
);

CREATE INDEX student_group_members_group_idx
  ON student_group_members (group_id);
