-- The AI panel (voice agent management). The agent runs as a separate
-- process, but the server owns everything the panel needs to manage it: the
-- retained voice transcripts and the Kiosk-role facts. agent.view gates
-- reading both; it stands alone (no prerequisite) because managing the agent
-- is an administrative concern, not a cafe one.

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, key
FROM roles r
CROSS JOIN (VALUES ('agent.view')) AS keys(key)
WHERE lower(r.name) = 'administrator'
ON CONFLICT DO NOTHING;

CREATE INDEX voice_transcripts_role_idx ON voice_transcripts (role, created_at DESC);
