-- Migration 030 solved score-page context reads by granting schedule.view to
-- every score role. The API now exposes assignment/session context under score,
-- dashboard and export permissions instead, preserving blind-entry least
-- privilege. Restore the two known system roles to their intended catalogues.
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.id
  AND r.is_system
  AND lower(r.name) IN ('staff', 'viewer')
  AND rp.permission_key = 'schedule.view';
