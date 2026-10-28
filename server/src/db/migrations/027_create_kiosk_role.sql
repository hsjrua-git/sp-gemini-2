-- Voice agent, from docs/voice-agent-architecture.md: the kiosk operates the
-- cafe through the same API as a human cashier, as a MACHINE USER in this
-- dedicated role (create the login with
--   npm run create-user -- cafe-kiosk "Cafe Kiosk (voice)" Kiosk
-- and give the credentials only to the agent process). The role holds the
-- blind-entry POS keys only: it can read the menu, find students by
-- name/code with the minimal-identity endpoint, and record/void sales. It
-- deliberately has NO students.view and NO balance key — a separate top-up
-- kiosk would get cafe.balance on its own login.
--
-- voice_transcripts is the agent's retained record (audio itself is
-- ephemeral by design): each dialogue turn, the recognized intent/tool
-- calls, and whether audio was (exceptionally) kept. The agent process
-- writes here with its own database credentials (AGENT_DATABASE_URL); at
-- stage 3+ that credential should be a least-privilege Postgres role
-- limited to this table (see the architecture doc §5).

CREATE TABLE voice_transcripts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   text NOT NULL,
  role         text NOT NULL,
  text         text NOT NULL,
  meta         jsonb,
  audio_kept   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_transcripts_role_ck CHECK (role IN ('user', 'agent')),
  CONSTRAINT voice_transcripts_session_ck CHECK (char_length(btrim(session_id)) BETWEEN 1 AND 64),
  CONSTRAINT voice_transcripts_text_ck CHECK (char_length(btrim(text)) BETWEEN 1 AND 2000)
);

CREATE INDEX voice_transcripts_session_idx ON voice_transcripts (session_id, created_at);
CREATE INDEX voice_transcripts_created_idx ON voice_transcripts (created_at DESC);

-- The Kiosk role, seeded once. System: it anchors the kiosk's authority and
-- must exist for the documented create-user command to work.
INSERT INTO roles (name, description, is_system)
SELECT 'Kiosk', 'Voice kiosk: cafe menu, minimal student lookup, sales and voids', true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE lower(name) = 'kiosk');

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, key
FROM roles r
CROSS JOIN (VALUES ('cafe.view'), ('cafe.sell')) AS keys(key)
WHERE lower(r.name) = 'kiosk'
ON CONFLICT DO NOTHING;
