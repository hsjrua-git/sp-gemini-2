import { Router } from 'express';
import pool from '../db/pool.js';
import { isValidIsoDate } from '../lib/periods.js';

const router = Router();
const MAX_LISTED = 100;

// What the SERVER knows about the voice agent. The agent is a separate
// process and does not report state here — this is the kiosk setup's
// footprint: whether the Kiosk role is in place, which logins hold it, and
// how much retained dialogue there is. The status page pairs these facts
// with the setup checklist from agent/README.md.
router.get('/status', async (req, res) => {
  const kioskRole = (
    await pool.query(`SELECT id FROM roles WHERE lower(name) = 'kiosk'`)
  ).rows[0];
  const kioskUsers = kioskRole
    ? await pool.query(
        `SELECT username FROM users WHERE role_id = $1 AND is_active ORDER BY username`,
        [kioskRole.id]
      )
    : { rows: [] };
  const stats = (
    await pool.query(
      `SELECT count(*)::int AS turns,
              count(DISTINCT session_id)::int AS sessions,
              max(created_at) AS last_turn,
              count(*) FILTER (WHERE audio_kept)::int AS audio_kept
       FROM voice_transcripts`
    )
  ).rows[0];
  const voiceAudit = (
    await pool.query(
      `SELECT count(*)::int AS sales_recorded
       FROM audit_log WHERE action = 'cafe_sale.create' AND details->>'saleId' IS NOT NULL
         AND (details->>'note' = 'voice' OR details->>'note' LIKE 'voice:%')`
    )
  ).rows[0];

  res.json({
    kioskRoleExists: Boolean(kioskRole),
    kioskUsers: kioskUsers.rows.map((row) => row.username),
    transcripts: {
      turns: stats.turns,
      sessions: stats.sessions,
      lastTurn: stats.last_turn,
      audioKept: stats.audio_kept,
    },
    voiceSales: voiceAudit.sales_recorded,
  });
});

// The retained dialogue log (audio itself is ephemeral by design). Filters:
// session, role, and an optional date range. New-to-old.
router.get('/transcripts', async (req, res) => {
  const { sessionId, role, from, to } = req.query;

  const conditions = ['TRUE'];
  const values = [];
  const push = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (sessionId !== undefined) {
    conditions.push(`session_id = ${push(String(sessionId).slice(0, 64))}`);
  }
  if (role !== undefined) {
    if (role !== 'user' && role !== 'agent') {
      return res.status(400).json({
        error: 'role must be user or agent.',
        code: 'VALIDATION_INVALID_CHOICE',
      });
    }
    conditions.push(`role = ${push(role)}`);
  }
  if (from !== undefined) {
    if (!isValidIsoDate(from)) {
      return res.status(400).json({
        error: 'from must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
      });
    }
    conditions.push(`created_at >= ${push(from)}::date`);
  }
  if (to !== undefined) {
    if (!isValidIsoDate(to)) {
      return res.status(400).json({
        error: 'to must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
      });
    }
    conditions.push(`created_at < (${push(to)}::date + 1)`);
  }

  const result = await pool.query(
    `SELECT id,
            session_id     AS "sessionId",
            role,
            text,
            meta,
            audio_kept     AS "audioKept",
            created_at     AS "createdAt"
     FROM voice_transcripts
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ${MAX_LISTED + 1}`,
    values
  );
  res.json({
    transcripts: result.rows.slice(0, MAX_LISTED),
    truncated: result.rows.length > MAX_LISTED,
  });
});

export default router;
