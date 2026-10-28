// Service-layer test for the assignment period calendar — real service
// functions against a fresh in-memory PGlite.
//
//   node --test src/core/services/periods.test.js
//
// Each test gets its own in-memory database. There is no school-wide period
// anymore: every assignment buckets its own non-canceled sessions (4 per
// period, in date order) into periods 1, 2, 3…, materialized on demand.

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
  const pool = createPglitePool(); // in-memory
  await pool.ready();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
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
    assert.equal(err.name, 'ServiceError', `expected a ServiceError, got ${err}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    return true;
  });
}

// A teacher + interval + group assignment with `count` weekly sessions.
async function seedAssignment(pool, { sessions = 0, canceled = [] } = {}) {
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
      [teacher, interval, group],
    )
  ).rows[0].id;
  const start = Date.UTC(2024, 0, 6);
  for (let index = 0; index < sessions; index++) {
    const date = new Date(start + index * 7 * DAY_MS).toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO sessions (assignment_id, seq, code, planned_date, canceled_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [assignmentId, index + 1, `S${index + 1}`, date, canceled.includes(index) ? new Date() : null],
    );
  }
  return assignmentId;
}

test('listPeriods: validates the id and 404s an unknown assignment', async () => {
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

test('listPeriods: buckets sessions 4 per period in date order, skipping canceled', async () => {
  const pool = await freshDb();
  try {
    // 9 sessions, one canceled → 8 effective sessions = 2 periods.
    const assignmentId = await seedAssignment(pool, {
      sessions: 9,
      canceled: [8], // the LAST session, so order stays clean
    });

    const { periods } = await listPeriods(assignmentId);
    assert.equal(periods.length, 2);
    assert.deepEqual(
      periods.map((period) => period.seq),
      [1, 2]
    );
    assert.equal(periods[0].sessionCount, 4);
    assert.equal(periods[1].sessionCount, 4);
    // Period 1 spans the first four Saturdays.
    assert.equal(periods[0].startDate, '2024-01-06');
    assert.equal(periods[0].endDate, '2024-01-27');
    assert.equal(periods[1].startDate, '2024-02-03');
    // No cells answered yet.
    assert.equal(periods[0].answeredCount, 0);
  } finally {
    await pool.end();
  }
});

test('listPeriods: answeredCount reflects saved cells and the sync is idempotent', async () => {
  const pool = await freshDb();
  try {
    const assignmentId = await seedAssignment(pool, { sessions: 4 });
    const session = (
      await pool.query(
        `SELECT id FROM sessions WHERE assignment_id = $1 ORDER BY seq LIMIT 1`,
        [assignmentId],
      )
    ).rows[0];
    const parameter = (
      await pool.query(
        `INSERT INTO parameters (code, name, min_value, max_value)
         VALUES ('focus', 'Focus', 0, 10) RETURNING id`
      )
    ).rows[0];

    await pool.query(
      `INSERT INTO evaluations (session_id, parameter_id, membership_id, quality_value, locks_at)
       VALUES ($1, $2, NULL, 6, now() + interval '7 days')`,
      [session.id, parameter.id],
    );

    const first = await listPeriods(assignmentId);
    assert.equal(first.periods[0].answeredCount, 1);
    // Syncing again neither duplicates nor renumbers.
    const second = await listPeriods(assignmentId);
    assert.deepEqual(second.periods, first.periods);
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM periods')).rows[0].n,
      1,
    );
  } finally {
    await pool.end();
  }
});
