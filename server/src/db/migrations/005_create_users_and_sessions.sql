CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username             text NOT NULL,
  full_name            text NOT NULL,
  password_hash        text NOT NULL,
  role                 text NOT NULL,
  is_active            boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role_valid CHECK (role IN ('viewer', 'staff', 'admin')),
  CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
  CONSTRAINT users_full_name_length
    CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX users_username_unique ON users (lower(username));

CREATE TABLE user_sessions (
  sid    varchar PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX user_sessions_expire_idx ON user_sessions (expire);