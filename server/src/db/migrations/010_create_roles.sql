-- Configurable roles. Until now roles were three fixed strings on the users
-- table (viewer/staff/admin). This replaces that with a roles table plus a
-- role_permissions table, and points each user at a role by id. The three
-- starter roles are seeded with exactly the abilities the fixed roles had, so
-- nothing changes for anyone today.

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 50)
);

CREATE UNIQUE INDEX roles_name_lower_unique ON roles (lower(name));

CREATE TABLE role_permissions (
  role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

-- Seed the three system roles.
INSERT INTO roles (name, description, is_system) VALUES
  ('Viewer', 'Read-only access to students, scores and reports.', true),
  ('Staff', 'Everything a Viewer can do, plus adding students and entering scores.', true),
  ('Administrator', 'Full access, including users, roles and settings.', true);

-- Viewer permissions.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, key
FROM roles r
CROSS JOIN (VALUES
  ('students.view'),
  ('scores.view'),
  ('parameters.view'),
  ('dashboard.view'),
  ('data.export')
) AS keys(key)
WHERE lower(r.name) = 'viewer';

-- Staff permissions (Viewer set plus the write actions staff had).
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, key
FROM roles r
CROSS JOIN (VALUES
  ('students.view'),
  ('scores.view'),
  ('parameters.view'),
  ('dashboard.view'),
  ('data.export'),
  ('students.create'),
  ('students.edit'),
  ('scores.enter'),
  ('groups.assign')
) AS keys(key)
WHERE lower(r.name) = 'staff';

-- Administrator permissions (everything).
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, key
FROM roles r
CROSS JOIN (VALUES
  ('students.view'),
  ('students.create'),
  ('students.edit'),
  ('students.delete'),
  ('groups.manage'),
  ('groups.assign'),
  ('scores.view'),
  ('scores.enter'),
  ('scores.override'),
  ('parameters.view'),
  ('parameters.manage'),
  ('fields.manage'),
  ('fields.view_restricted'),
  ('dashboard.view'),
  ('data.export'),
  ('data.import'),
  ('views.share'),
  ('settings.manage'),
  ('users.manage'),
  ('roles.manage'),
  ('audit.view')
) AS keys(key)
WHERE lower(r.name) = 'administrator';

-- Point users at their role by id, then retire the old text column.
ALTER TABLE users ADD COLUMN role_id uuid REFERENCES roles(id);

UPDATE users SET role_id = (SELECT id FROM roles WHERE lower(name) = 'viewer')
  WHERE role = 'viewer';
UPDATE users SET role_id = (SELECT id FROM roles WHERE lower(name) = 'staff')
  WHERE role = 'staff';
UPDATE users SET role_id = (SELECT id FROM roles WHERE lower(name) = 'administrator')
  WHERE role = 'admin';

ALTER TABLE users ALTER COLUMN role_id SET NOT NULL;
ALTER TABLE users DROP CONSTRAINT users_role_valid;
ALTER TABLE users DROP COLUMN role;
