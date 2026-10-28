// Rolled-back live PostgreSQL smoke for schema-4 alert synchronization.
// Run from server/: node --env-file=.env src/scripts/alertsSmoke.mjs

import assert from 'node:assert/strict';
import pool from '../db/pool.js';
import { scanAlerts } from '../lib/alerts.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // Settle seeded history, then establish the idempotent baseline.
  await scanAlerts(client);
  assert.deepEqual(await scanAlerts(client), { raised: 0, resolved: 0 });

  const teacher = await client.query(
    `INSERT INTO teachers (code, full_name, birth_date, national_id)
     VALUES ('ZZSMOKE-T', 'Smoke Teacher', '1990-01-01', '0000000999')
     RETURNING id`
  );
  const group = await client.query(
    `INSERT INTO student_groups (name, code)
     VALUES ('ZZSmoke Group', 'zz-alert-smoke') RETURNING id`
  );
  const interval = await client.query(
    `SELECT id FROM intervals WHERE archived_at IS NULL ORDER BY sort_order LIMIT 1`
  );
  const assignment = await client.query(
    `INSERT INTO assignments (code, teacher_id, interval_id, group_id, anchor_date)
     VALUES ('ZZSMOKE-A', $1, $2, $3, current_date - 30)
     RETURNING id`,
    [teacher.rows[0].id, interval.rows[0].id, group.rows[0].id]
  );
  const assignmentId = assignment.rows[0].id;
  const parameter = await client.query(
    `INSERT INTO parameters (code, name, min_value, max_value)
     VALUES ('ZZ-ALERT', 'Alert smoke parameter', 0, 10) RETURNING id`
  );

  const addSession = async (planned) =>
    (
      await client.query(
        `INSERT INTO sessions (assignment_id, planned_date)
         VALUES ($1, ${planned})
         RETURNING id, code`,
        [assignmentId]
      )
    ).rows[0];

  const unconfirmed = await addSession('current_date - 10');
  const noted = await addSession('current_date - 9');
  await client.query(`UPDATE sessions SET note = 'note taken' WHERE id = $1`, [noted.id]);
  const canceled = await addSession('current_date - 8');
  await client.query(`UPDATE sessions SET canceled_at = now() WHERE id = $1`, [canceled.id]);
  await addSession('current_date + 8');

  // Notes do not substitute for required answers; canceled/future sessions do
  // not alert. Repeated scans are idempotent.
  assert.deepEqual(await scanAlerts(client), { raised: 2, resolved: 0 });
  assert.deepEqual(await scanAlerts(client), { raised: 0, resolved: 0 });

  // A resolved alert remains history and may be raised again while the session
  // is still incomplete.
  const firstAlert = (
    await client.query(
      `SELECT id FROM alerts
       WHERE session_id = $1 AND resolved_at IS NULL`,
      [unconfirmed.id]
    )
  ).rows[0];
  await client.query(`UPDATE alerts SET resolved_at = now() WHERE id = $1`, [firstAlert.id]);
  assert.deepEqual(await scanAlerts(client), { raised: 1, resolved: 0 });

  // An empty selected cell is incomplete. Filling it resolves the open alert
  // in the same transaction and attaches the session to a period.
  const selectedOnly = await addSession('current_date - 7');
  const cell = await client.query(
    `INSERT INTO evaluations
       (session_id, parameter_id, membership_id, locks_at)
     VALUES ($1, $2, NULL, now() + interval '1 day')
     RETURNING id`,
    [selectedOnly.id, parameter.rows[0].id]
  );
  assert.deepEqual(await scanAlerts(client), { raised: 1, resolved: 0 });
  await client.query(`UPDATE evaluations SET quality_value = 8 WHERE id = $1`, [cell.rows[0].id]);
  const completed = (
    await client.query(
      `SELECT s.period_id IS NOT NULL AS attached,
              a.resolved_at IS NOT NULL AS resolved
       FROM sessions s
       JOIN alerts a ON a.session_id = s.id
       WHERE s.id = $1`,
      [selectedOnly.id]
    )
  ).rows[0];
  assert.deepEqual(completed, { attached: true, resolved: true });

  // Making an unscored session inactive also resolves its alert immediately.
  const laterCanceled = await addSession('current_date - 6');
  assert.deepEqual(await scanAlerts(client), { raised: 1, resolved: 0 });
  await client.query(`UPDATE sessions SET canceled_at = now() WHERE id = $1`, [
    laterCanceled.id,
  ]);
  const inactiveAlert = await client.query(
    `SELECT resolved_at IS NOT NULL AS resolved
     FROM alerts WHERE session_id = $1`,
    [laterCanceled.id]
  );
  assert.equal(inactiveAlert.rows[0].resolved, true);

  const history = await client.query(
    `SELECT a.kind, a.message, s.code AS "sessionCode",
            s.session_date::text AS "sessionDate"
     FROM alerts a
     JOIN sessions s ON s.id = a.session_id
     WHERE a.session_id = $1
     ORDER BY a.created_at`,
    [unconfirmed.id]
  );
  assert.equal(history.rows.length, 2);
  assert.equal(history.rows[1].kind, 'session_unconfirmed');
  assert.equal(history.rows[1].sessionCode, unconfirmed.code);
  assert.match(history.rows[1].message, new RegExp(unconfirmed.code));
  assert.match(history.rows[1].sessionDate, /^\d{4}-\d{2}-\d{2}$/);

  console.log('alerts smoke: all 6 checks passed');
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
