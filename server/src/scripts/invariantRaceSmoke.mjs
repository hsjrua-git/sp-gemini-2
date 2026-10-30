// Real-PostgreSQL two-connection probes. PGlite verifies SQL semantics but is a
// single connection and cannot prove cross-transaction serialization.
import assert from 'node:assert/strict';
import pool from '../db/pool.js';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function hierarchyRace({ table, insert, label }) {
  const ids = (await pool.query(insert)).rows.map((row) => row.id);
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(`UPDATE ${table} SET parent_id = $2 WHERE id = $1`, [
      ids[0],
      ids[1],
    ]);
    const competing = second.query(
      `UPDATE ${table} SET parent_id = $2 WHERE id = $1`,
      [ids[1], ids[0]]
    );
    await pause(50);
    await first.query('COMMIT');
    await assert.rejects(competing, (err) => err.code === '23514', label);
    await second.query('ROLLBACK');
  } finally {
    await first.query('ROLLBACK').catch(() => {});
    await second.query('ROLLBACK').catch(() => {});
    first.release();
    second.release();
    await pool.query(`UPDATE ${table} SET parent_id = NULL WHERE id = ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
  }
}

async function fiscalOverlapRace() {
  const first = await pool.connect();
  const second = await pool.connect();
  let periodId = null;
  try {
    await first.query('BEGIN');
    await second.query('BEGIN');
    periodId = (
      await first.query(
        `INSERT INTO acct_fiscal_periods (name, start_date, end_date)
         VALUES ('ZZ invariant race A', '2097-01-01', '2097-06-30')
         RETURNING id`
      )
    ).rows[0].id;
    const competing = second.query(
      `INSERT INTO acct_fiscal_periods (name, start_date, end_date)
       VALUES ('ZZ invariant race B', '2097-04-01', '2097-12-31')`
    );
    await pause(50);
    await first.query('COMMIT');
    await assert.rejects(
      competing,
      (err) => err.code === '23P01',
      'overlapping fiscal periods serialize'
    );
    await second.query('ROLLBACK');
  } finally {
    await first.query('ROLLBACK').catch(() => {});
    await second.query('ROLLBACK').catch(() => {});
    first.release();
    second.release();
    if (periodId) await pool.query('DELETE FROM acct_fiscal_periods WHERE id = $1', [periodId]);
  }
}

async function evaluationRangeRace() {
  const parameter = (
    await pool.query(
      `INSERT INTO parameters (code, name, min_value, max_value, sort_order)
       VALUES ('ZZ-RANGE-RACE', 'ZZ range race', 0, 100, 99999)
       RETURNING id`
    )
  ).rows[0];
  const session = (
    await pool.query(
      `SELECT s.id
       FROM sessions s
       JOIN assignments a ON a.id = s.assignment_id
       WHERE s.archived_at IS NULL
         AND s.canceled_at IS NULL
         AND a.archived_at IS NULL
         AND a.group_id IS NOT NULL
       ORDER BY s.id
       LIMIT 1`
    )
  ).rows[0];
  assert.ok(session, 'the range race needs one seeded session');
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query('UPDATE parameters SET min_value = 50 WHERE id = $1', [parameter.id]);
    const competing = second.query(
      `INSERT INTO evaluations
         (session_id, parameter_id, membership_id, quantity_value, locks_at)
       VALUES ($1, $2, NULL, 40, now() + interval '1 day')`,
      [session.id, parameter.id]
    );
    await pause(50);
    await first.query('COMMIT');
    await assert.rejects(
      competing,
      (err) => err.code === '23514',
      'evaluation insert sees the committed narrowed range'
    );
    await second.query('ROLLBACK');
  } finally {
    await first.query('ROLLBACK').catch(() => {});
    await second.query('ROLLBACK').catch(() => {});
    first.release();
    second.release();
    await pool.query('DELETE FROM evaluations WHERE parameter_id = $1', [parameter.id]);
    await pool.query('DELETE FROM parameters WHERE id = $1', [parameter.id]);
  }
}

async function periodCapacityRace(suffix) {
  const ids = {
    teacher: null,
    group: null,
    assignment: null,
    parameter: null,
    sessions: [],
  };
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    const nationalId = `9${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`;
    const interval = (
      await pool.query(
        `SELECT id FROM intervals WHERE archived_at IS NULL ORDER BY sort_order LIMIT 1`
      )
    ).rows[0];
    assert.ok(interval, 'period race needs one active interval');
    ids.teacher = (
      await pool.query(
        `INSERT INTO teachers (code, full_name, birth_date, national_id)
         VALUES ($1, $2, '1980-01-01', $3) RETURNING id`,
        [`ZZT-${suffix}`, `ZZ period teacher ${suffix}`, nationalId]
      )
    ).rows[0].id;
    ids.group = (
      await pool.query(
        `INSERT INTO student_groups (code, name) VALUES ($1, $2) RETURNING id`,
        [`zz-period-${suffix}`, `ZZ period group ${suffix}`]
      )
    ).rows[0].id;
    ids.assignment = (
      await pool.query(
        `INSERT INTO assignments
           (code, name, teacher_id, interval_id, group_id, anchor_date)
         VALUES ($1, $2, $3, $4, $5, '2098-01-01') RETURNING id`,
        [
          `ZZP-${suffix}`,
          `ZZ period assignment ${suffix}`,
          ids.teacher,
          interval.id,
          ids.group,
        ]
      )
    ).rows[0].id;
    ids.parameter = (
      await pool.query(
        `INSERT INTO parameters (code, name, min_value, max_value, sort_order)
         VALUES ($1, $2, 0, 10, 99998) RETURNING id`,
        [`ZZ-PERIOD-${suffix}`, `ZZ period parameter ${suffix}`]
      )
    ).rows[0].id;
    for (let index = 0; index < 5; index++) {
      ids.sessions.push(
        (
          await pool.query(
            `INSERT INTO sessions (assignment_id, planned_date)
             VALUES ($1, ('2098-01-01'::date + $2::int)) RETURNING id`,
            [ids.assignment, index]
          )
        ).rows[0].id
      );
    }
    for (const sessionId of ids.sessions.slice(0, 3)) {
      await pool.query(
        `INSERT INTO evaluations
           (session_id, parameter_id, membership_id, quality_value, locks_at)
         VALUES ($1, $2, NULL, 5, '2099-01-01')`,
        [sessionId, ids.parameter]
      );
    }

    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(
      `INSERT INTO evaluations
         (session_id, parameter_id, membership_id, quality_value, locks_at)
       VALUES ($1, $2, NULL, 6, '2099-01-01')`,
      [ids.sessions[3], ids.parameter]
    );
    const competing = second.query(
      `INSERT INTO evaluations
         (session_id, parameter_id, membership_id, quality_value, locks_at)
       VALUES ($1, $2, NULL, 7, '2099-01-01')`,
      [ids.sessions[4], ids.parameter]
    );
    await pause(50);
    await first.query('COMMIT');
    await competing;
    await second.query('COMMIT');

    const counts = await pool.query(
      `SELECT p.seq, count(s.id)::int AS count
       FROM periods p
       LEFT JOIN sessions s
         ON s.period_id = p.id
        AND s.archived_at IS NULL
        AND s.canceled_at IS NULL
       WHERE p.assignment_id = $1 AND p.archived_at IS NULL
       GROUP BY p.id, p.seq
       ORDER BY p.seq`,
      [ids.assignment]
    );
    assert.deepEqual(
      counts.rows.map(({ seq, count }) => ({ seq, count })),
      [
        { seq: 1, count: 4 },
        { seq: 2, count: 1 },
      ],
      'concurrent first answers preserve four-session capacity'
    );
  } finally {
    await first.query('ROLLBACK').catch(() => {});
    await second.query('ROLLBACK').catch(() => {});
    first.release();
    second.release();
    if (ids.sessions.length > 0) {
      await pool.query(`DELETE FROM evaluations WHERE session_id = ANY($1::uuid[])`, [
        ids.sessions,
      ]);
      await pool.query(`DELETE FROM sessions WHERE id = ANY($1::uuid[])`, [ids.sessions]);
    }
    if (ids.assignment) {
      await pool.query(`DELETE FROM periods WHERE assignment_id = $1`, [ids.assignment]);
      await pool.query(`DELETE FROM assignments WHERE id = $1`, [ids.assignment]);
    }
    if (ids.parameter) await pool.query(`DELETE FROM parameters WHERE id = $1`, [ids.parameter]);
    if (ids.group) await pool.query(`DELETE FROM student_groups WHERE id = $1`, [ids.group]);
    if (ids.teacher) await pool.query(`DELETE FROM teachers WHERE id = $1`, [ids.teacher]);
  }
}

try {
  const suffix = Math.random().toString(36).slice(2, 9);
  await hierarchyRace({
    table: 'student_groups',
    insert: `INSERT INTO student_groups (code, name) VALUES
      ('zz-race-g-a-${suffix}', 'ZZ race group A ${suffix}'),
      ('zz-race-g-b-${suffix}', 'ZZ race group B ${suffix}')
      RETURNING id`,
    label: 'group parent changes serialize',
  });
  await hierarchyRace({
    table: 'acct_accounts',
    insert: `INSERT INTO acct_accounts (code, name, type) VALUES
      ('ZZRA-${suffix}', 'ZZ race account A ${suffix}', 'asset'),
      ('ZZRB-${suffix}', 'ZZ race account B ${suffix}', 'asset')
      RETURNING id`,
    label: 'account parent changes serialize',
  });
  await fiscalOverlapRace();
  await evaluationRangeRace();
  await periodCapacityRace(suffix);
  console.log('runtime invariant race smoke: all 5 checks passed');
} finally {
  await pool.end();
}
