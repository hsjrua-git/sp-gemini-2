CREATE TABLE saved_views (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       text NOT NULL,
  config     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_view_name_length
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 60)
);

CREATE UNIQUE INDEX saved_views_user_name_unique
  ON saved_views (user_id, lower(name));