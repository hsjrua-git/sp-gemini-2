-- Scheduling, from the schema-4 reference design: intervals (the recurrence
-- rhythm) and assignments (a teacher meets a group — or one member — every
-- interval, from an anchor date). Sessions are generated from these in the
-- next migration; assignments never store occurrences themselves.

CREATE TABLE intervals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  every      interval NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT intervals_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT intervals_every_positive CHECK (every > interval '0'),
  CONSTRAINT intervals_sort_ck CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX intervals_name_unique ON intervals (lower(name));

CREATE TRIGGER intervals_updated_at
  BEFORE UPDATE ON intervals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A few common rhythms so a fresh install is immediately usable; all rows are
-- ordinary editable records, nothing is protected.
INSERT INTO intervals (name, every, sort_order) VALUES
  ('Every 3 days',  '3 days',   30),
  ('Weekly',        '7 days',   10),
  ('Every 2 weeks', '14 days',  20),
  ('Monthly',       '1 month',  40);

CREATE TABLE assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL,
  name          text,
  teacher_id    uuid NOT NULL REFERENCES teachers(id),
  interval_id   uuid NOT NULL REFERENCES intervals(id),
  group_id      uuid REFERENCES student_groups(id),
  membership_id uuid REFERENCES student_group_members(id),
  anchor_date   date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  CONSTRAINT assignments_code_ck CHECK (char_length(btrim(code)) BETWEEN 1 AND 40),
  CONSTRAINT assignments_name_ck
    CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT assignments_target_ck CHECK (num_nonnulls(group_id, membership_id) = 1)
);

CREATE UNIQUE INDEX assignments_code_unique ON assignments (code);
CREATE INDEX assignments_teacher_idx ON assignments (teacher_id);
CREATE INDEX assignments_group_idx ON assignments (group_id);
CREATE INDEX assignments_membership_idx ON assignments (membership_id);
-- One assignment per teacher/interval/target. Partial indexes because the
-- NULL side of the target pair must not collide.
CREATE UNIQUE INDEX assignments_teacher_interval_group_unique
  ON assignments (teacher_id, interval_id, group_id)
  WHERE group_id IS NOT NULL;
CREATE UNIQUE INDEX assignments_teacher_interval_member_unique
  ON assignments (teacher_id, interval_id, membership_id)
  WHERE membership_id IS NOT NULL;

CREATE TRIGGER assignments_updated_at
  BEFORE UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The Administrator role gains the scheduling keys.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, key
FROM roles r
CROSS JOIN (VALUES
  ('schedule.view'),
  ('schedule.manage')
) AS keys(key)
WHERE lower(r.name) = 'administrator'
ON CONFLICT DO NOTHING;
