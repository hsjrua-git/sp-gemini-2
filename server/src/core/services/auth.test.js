// Service-layer test for the static single-user auth stub — real service
// functions against a fresh in-memory PGlite.
//
//   node --test src/core/services/auth.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createPglitePool } from '../../db/pglite.js';
import { initDb } from '../db.js';
import { resetLocalUser } from '../context.js';
import { ensureLocalUser } from '../bootstrap.js';
import { getMe, can } from './auth.js';
import { PERMISSION_KEYS } from '../../lib/permissions.js';

const migrationsDir = path.join(import.meta.dirname, '..', '..', 'db', 'migrations');

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
  resetLocalUser();
  await ensureLocalUser(pool);
  return pool;
}

test('getMe: returns the local admin holding every permission', async () => {
  const pool = await freshDb();
  try {
    const { user } = await getMe();
    assert.equal(user.username, 'local');
    assert.equal(user.role, 'Administrator');
    assert.equal(user.isActive, true);
    assert.equal(user.mustChangePassword, false);
    // Never exposes the password hash.
    assert.equal(user.passwordHash, undefined);
    // Holds the entire fixed catalogue.
    assert.deepEqual([...user.permissions].sort(), [...PERMISSION_KEYS].sort());
  } finally {
    await pool.end();
  }
});

test('can: always true for the single admin', async () => {
  assert.equal(can(), true);
  assert.equal(can('anything.at.all'), true);
});
