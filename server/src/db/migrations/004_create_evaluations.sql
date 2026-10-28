CREATE TABLE evaluations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid NOT NULL REFERENCES students (id),
  parameter_id  uuid NOT NULL REFERENCES parameters (id),
  period_number integer NOT NULL,
  value         numeric,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_period_positive CHECK (period_number >= 1),
  UNIQUE (student_id, parameter_id, period_number)
);

CREATE INDEX evaluations_period_idx ON evaluations (period_number);
CREATE INDEX evaluations_parameter_idx ON evaluations (parameter_id);