CREATE TABLE parameters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  unit       text,
  min_value  numeric,
  max_value  numeric,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parameter_name_length
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT parameter_range_order
    CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);

CREATE UNIQUE INDEX parameters_name_unique ON parameters (lower(name));

CREATE TABLE parameter_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_id  uuid NOT NULL REFERENCES parameters (id),
  period_number integer NOT NULL,
  scope         text NOT NULL,
  action        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT change_period_positive CHECK (period_number >= 1),
  CONSTRAINT change_scope_valid
    CHECK (scope IN ('from_here_on', 'this_period_only')),
  CONSTRAINT change_action_valid CHECK (action IN ('add', 'remove')),
  UNIQUE (parameter_id, period_number, scope)
);