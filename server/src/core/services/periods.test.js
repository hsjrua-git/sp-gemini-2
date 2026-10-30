// Persisted schema-4 period lifecycle against a fresh in-memory PostgreSQL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createPglitePool } from '../../db/pglite.js';
import { initDb } from '../db.js';
import { listPeriods } from './periods.js';

const migrationsDir = path.join(import.meta.dirname, '..', '..', 'db', 'migrations');
const DAY_MS = 24 * 60 * 60 * 1000;

async function freshDb() {
  const pool = createPglitePool();
  await pool.ready();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  initDb(pool);
  return pool;
}

async function expectCode(code, fn) {
  await assert.rejects(fn, (err) => {
    assert.equal(err.name, 'ServiceError');
    assert.equal(err.code, code);
    return true;
  });
}

async function seedAssignment(pool, sessionCount = 0) {
  const teacher = (
    await pool.query(
      `INSERT INTO teachers (code, full_name, birth_date, national_id)
       VALUES ('T1000001', 'Ms. Tester', '1990-05-01', '0012345678')
       RETURNING id`
    )
  ).rows[0].id;
  const interval = (
    await pool.query(
      `INSERT INTO intervals (name, every) VALUES ('هفتگی', '7 days') RETURNING id`
    )
  ).rows[0].id;
  const group = (
    await pool.query(
      `INSERT INTO student_groups (name, code) VALUES ('Group A', 'GA') RETURNING id`
    )
  ).rows[0].id;
  const assignmentId = (
    await pool.query(
      `INSERT INTO assignments (code, teacher_id, interval_id, group_id, anchor_date)
       VALUES ('A1', $1, $2, $3, '2024-01-06') RETURNING id`,
      [teacher, interval, group]
    )
  ).rows[0].id;
  const sessionIds = [];
  const start = Date.UTC(2024, 0, 6);
  for (let index = 0; index < sessionCount; index++) {
    const date = new Date(start + index * 7 * DAY_MS).toISOString().slice(0, 10);
    sessionIds.push(
      (
        await pool.query(
          `INSERT INTO sessions (assignment_id, planned_date)
           VALUES ($1, $2) RETURNING id`,
          [assignmentId, date]
        )
      ).rows[0].id
    );
  }
  const parameterId = (
    await pool.query(
      `INSERT INTO parameters (code, name, min_value, max_value)
       VALUES ('focus', 'Focus', 0, 10) RETURNING id`
    )
  ).rows[0].id;
  return { assignmentId, sessionIds, parameterId };
}

async function insertCell(pool, { sessionId, parameterId, value = null }) {
  return pool.query(
    `INSERT INTO evaluations
       (session_id, parameter_id, membership_id, quality_value, locks_at)
     VALUES ($1, $2, NULL, $3, now() + interval '7 days')
     RETURNING id`,
    [sessionId, parameterId, value]
  );
}

test('listPeriods validates the id and 404s an unknown assignment', async () => {
  const pool = await freshDb();
  try {
    await expectCode('VALIDATION', () => listPeriods('nope'));
    await expectCode('NOT_FOUND', () =>
      listPeriods('00000000-0000-4000-8000-000000000000')
    );
  } finally {
    await pool.end();
  }
});

test('only answered sessions attach, four per persisted period', async () => {
  const pool = await freshDb();
  try {
    const { assignmentId, sessionIds, parameterId } = await seedAssignment(pool, 6);

    assert.deepEqual((await listPeriods(assignmentId)).periods, []);

    const empty = await insertCell(pool, {
      sessionId: sessionIds[0],
      parameterId,
    });
    assert.deepEqual((await listPeriods(assignmentId)).periods, []);

    await pool.query(
      `UPDATE evaluations SET quality_value = 6 WHERE id = $1`,
      [empty.rows[0].id]
    );
    let periods = (await listPeriods(assignmentId)).periods;
    assert.equal(periods.length, 1);
    assert.equal(periods[0].sessionCount, 1);
    assert.equal(periods[0].answeredCount, 1);
    assert.equal(periods[0].startDate, '2024-01-06');
    assert.equal(periods[0].isComplete, false);

    for (const sessionId of sessionIds.slice(1, 4)) {
      await insertCell(pool, { sessionId, parameterId, value: 7 });
    }
    periods = (await listPeriods(assignmentId)).periods;
    assert.equal(periods[0].sessionCount, 4);
    assert.equal(periods[0].isComplete, true);
    assert.equal(periods[0].endDate, '2024-01-27');

    await insertCell(pool, {
      sessionId: sessionIds[4],
      parameterId,
      value: 8,
    });
    periods = (await listPeriods(assignmentId)).periods;
    assert.deepEqual(
      periods.map(({ seq, sessionCount }) => ({ seq, sessionCount })),
      [
        { seq: 1, sessionCount: 4 },
        { seq: 2, sessionCount: 1 },
      ]
    );
  } finally {
    await pool.end();
  }
});

test('removing the final answer detaches; archive and restore reattach history', async () => {
  const pool = await freshDb();
  try {
    const { assignmentId, sessionIds, parameterId } = await seedAssignment(pool, 1);
    const cell = await insertCell(pool, {
      sessionId: sessionIds[0],
      parameterId,
      value: 5,
    });

    await pool.query('DELETE FROM evaluations WHERE id = $1', [cell.rows[0].id]);
    assert.equal(
      (await pool.query('SELECT period_id FROM sessions WHERE id = $1', [sessionIds[0]]))
        .rows[0].period_id,
      null
    );

    await insertCell(pool, { sessionId: sessionIds[0], parameterId, value: 9 });
    await pool.query('UPDATE sessions SET archived_at = now() WHERE id = $1', [sessionIds[0]]);
    assert.equal(
      (await pool.query('SELECT period_id FROM sessions WHERE id = $1', [sessionIds[0]]))
        .rows[0].period_id,
      null
    );
    await pool.query('UPDATE sessions SET archived_at = NULL WHERE id = $1', [sessionIds[0]]);
    const restored = await pool.query(
      `SELECT p.seq
       FROM sessions s
       JOIN periods p ON p.id = s.period_id
       WHERE s.id = $1`,
      [sessionIds[0]]
    );
    assert.equal(restored.rows[0].seq, 1);
    assert.equal((await listPeriods(assignmentId)).periods[0].sessionCount, 1);
  } finally {
    await pool.end();
  }
});
