ALTER TABLE evaluations ADD COLUMN locks_at timestamptz;

UPDATE evaluations SET locks_at = created_at + interval '7 days';

ALTER TABLE evaluations ALTER COLUMN locks_at SET NOT NULL;