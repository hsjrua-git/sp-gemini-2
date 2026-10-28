// One-off smoke test for lib/alerts.js scan semantics against the live
// database, entirely inside a transaction that rolls back. Run with:
//   node --env-file=.env scripts/alertsSmoke.mjs
// (mirrors the rolled-back live check the sessions generation got).
//
// now() is frozen per transaction, so the "manual resolution is honored" and
// "the problem can return" paths are exercised by setting the alert's
// resolved_at explicitly: a FUTURE stamp plays "resolved after the session's
// last change" (blocked from re-raising), a PAST stamp plays "resolved before
// the session changed again" (re-raised).

import assert from 'node:assert/strict';
import pool from '../db/pool.js';
import { scanAlerts } from '../lib/alerts.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');

  const teacher = await client.query(
    `INSERT INTO teachers (code, full_name, birth_date, national_id)
     VALUES ('ZZSMOKE-T', 'Smoke Teacher', '1990-01-01', '0000000999')
     RETURNING id`
  );
  const group = await client.query(
    `INSERT INTO student_groups (name) VALUES ('ZZSmoke Group') RETURNING id`
  );
  const interval = await client.query(
    `SELECT id FROM intervals WHERE name = 'Weekly' LIMIT 1`
  );
  const assignment = await client.query(
    `INSERT INTO assignments (code, teacher_id, interval_id, group_id, anchor_date)
     VALUES ('ZZSMOKE-A', $1, $2, $3, current_date - 30)
     RETURNING id`,
    [teacher.rows[0].id, interval.rows[0].id, group.rows[0].id]
  );
  const assignmentId = assignment.rows[0].id;

  // `planned` is one of this script's own date expressions, interpolated on
  // purpose — a bind parameter would arrive as a text literal, not SQL.
  const session = async (seq, planned) =>
    (
      await client.query(
        `INSERT INTO sessions (assignment_id, seq, code, planned_date)
         VALUES ($1, $2, $3, ${planned})
         RETURNING id`,
        [assignmentId, seq, `ZZSMOKE-S${seq}`]
      )
    ).rows[0].id;

  // The four shapes: unconfirmed past, past with a note, canceled past, future.
  const unconfirmed = await session(1, 'current_date - 10');
  const noted = await session(2, 'current_date - 9');
  await client.query(
    `UPDATE sessions SET note = 'note taken' WHERE id = $1`,
    [noted]
  );
  const canceled = await session(3, 'current_date - 8');
  await client.query(
    `UPDATE sessions SET canceled_at = now() WHERE id = $1`,
    [canceled]
  );
  await session(4, 'current_date + 8');

  // 1. First scan raises exactly the unconfirmed past session.
  let result = await scanAlerts(client);
  assert.deepEqual(result, { raised: 1, resolved: 0 }, 'scan 1');
  const alert = (
    await client.query(
      `SELECT id, resolved_at FROM alerts WHERE session_id = $1`,
      [unconfirmed]
    )
  ).rows[0];
  assert.ok(alert, 'alert row exists');
  assert.equal(alert.resolved_at, null, 'alert starts open');

  // 2. Idempotent: nothing new, nothing closed.
  result = await scanAlerts(client);
  assert.deepEqual(result, { raised: 0, resolved: 0 }, 'scan 2 idempotent');

  // 3. A manual resolution AFTER the session's last change is honored.
  await client.query(
    `UPDATE alerts SET resolved_at = now() + interval '1 hour' WHERE id = $1`,
    [alert.id]
  );
  result = await scanAlerts(client);
  assert.deepEqual(result, { raised: 0, resolved: 0 }, 'scan 3 honors resolution');

  // 4. The problem can return: a resolution that PREDATES a new session
  //    change (note added then removed) lets the alert be raised again.
  await client.query(
    `UPDATE alerts SET resolved_at = now() - interval '1 hour' WHERE id = $1`,
    [alert.id]
  );
  await client.query(
    `UPDATE sessions SET note = 'temp' WHERE id = $1`,
    [unconfirmed]
  );
  await client.query(
    `UPDATE sessions SET note = NULL WHERE id = $1`,
    [unconfirmed]
  );
  result = await scanAlerts(client);
  assert.deepEqual(result, { raised: 1, resolved: 0 }, 'scan 4 re-raises');

  // 5. Auto-cleanup: a NEW open alert closes itself once the session is
  //    canceled (no user action needed).
  const late = await session(5, 'current_date - 7');
  result = await scanAlerts(client);
  assert.deepEqual(result, { raised: 1, resolved: 0 }, 'scan 5 raises the late one');
  await client.query(
    `UPDATE sessions SET canceled_at = now() WHERE id = $1`,
    [late]
  );
  result = await scanAlerts(client);
  assert.deepEqual(result, { raised: 0, resolved: 1 }, 'scan 6 auto-resolves');

  // 6. The list join (same SQL shape as routes/alerts.js) resolves every
  //    column and camelCases correctly.
  const listed = await client.query(
    `SELECT a.id, a.kind, a.session_id AS "sessionId", a.message,
            a.resolved_at AS "resolvedAt", a.created_at AS "createdAt",
            s.code AS "sessionCode", s.session_date AS "sessionDate",
            s.canceled_at AS "sessionCanceledAt",
            asg.code AS "assignmentCode", asg.name AS "assignmentName",
            t.full_name AS "teacherName", g.name AS "groupName",
            sf.full_name AS "studentName"
     FROM alerts a
     LEFT JOIN sessions s ON s.id = a.session_id
     LEFT JOIN assignments asg ON asg.id = s.assignment_id
     LEFT JOIN teachers t ON t.id = asg.teacher_id
     LEFT JOIN student_groups g ON g.id = asg.group_id
     LEFT JOIN student_group_members ms ON ms.id = asg.membership_id
     LEFT JOIN students sf ON sf.id = ms.student_id
     WHERE a.session_id = $1
     ORDER BY a.resolved_at IS NOT NULL, a.created_at DESC`,
    [unconfirmed]
  );
  assert.ok(listed.rows.length >= 2, 'history kept for the session');
  const open = listed.rows.find((row) => row.resolvedAt === null);
  assert.equal(open.kind, 'session_unconfirmed');
  assert.equal(open.sessionCode, 'ZZSMOKE-S1');
  assert.equal(open.teacherName, 'Smoke Teacher');
  assert.equal(open.groupName, 'ZZSmoke Group');
  assert.match(open.message, /ZZSMOKE-S1/);

  console.log('alerts smoke: all 6 checks passed');
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
