CREATE TABLE user_preferences (
  user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);