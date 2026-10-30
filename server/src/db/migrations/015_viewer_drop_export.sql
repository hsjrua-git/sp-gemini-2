-- Narrow the built-in Viewer role to a pure read-only role. Viewer was seeded
-- (migration 010) with data.export, but exporting the full roster and score
-- history to CSV is a data-egress action that should not come for free with a
-- look-only account. Staff and Administrator keep data.export.
--
-- Scope this to the *system* Viewer role only, and only when its permission set
-- still matches the original seed, so we never touch a Viewer role an admin has
-- since customised. Idempotent: re-running deletes nothing once it is gone.
DELETE FROM role_permissions
WHERE permission_key = 'data.export'
  AND role_id = (
    SELECT id FROM roles WHERE is_system AND lower(name) = 'viewer'
  );
