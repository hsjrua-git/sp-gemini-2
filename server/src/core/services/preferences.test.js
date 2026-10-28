// Service-layer test for user preferences — real service functions against a
// fresh in-memory PGlite.
//
//   node --test src/core/services/preferences.test.js
//
// user_preferences.user_id is a NOT NULL FK to users(id), so freshDb() calls
// ensureLocalUser() after migrations to seed the single local user.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createPglitePool } from '../../db/pglite.js';
import { initDb } from '../db.js';
import { resetLocalUser } from '../context.js';
import { ensureLocalUser } from '../bootstrap.js';
import {
  getPreferences,
  updatePreferences,
  resetPreferences,
} from './preferences.js';
import { DEFAULT_PREFERENCES } from '../../lib/preferences.js';

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

async function expectCode(code, fn) {
  await assert.rejects(fn, (err) => {
    assert.equal(err.name, 'ServiceError', `expected a ServiceError, got ${err}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    return true;
  });
}

test('getPreferences: returns defaults when nothing is stored', async () => {
  const pool = await freshDb();
  try {
    const { preferences } = await getPreferences();
    assert.deepEqual(preferences, {
      ...DEFAULT_PREFERENCES,
      hiddenParameterIds: [],
    });
  } finally {
    await pool.end();
  }
});

test('updatePreferences: validates the patch', async () => {
  const pool = await freshDb();
  try {
    await expectCode('VALIDATION', () => updatePreferences(null));
    await expectCode('VALIDATION', () => updatePreferences({}));
    await expectCode('VALIDATION', () => updatePreferences({ nope: 1 }));
    await expectCode('VALIDATION', () => updatePreferences({ theme: 'purple' }));
    await expectCode('VALIDATION', () =>
      updatePreferences({ studentsPageSize: 7 }),
    );
  } finally {
    await pool.end();
  }
});

test('updatePreferences: merges partial patches and persists them', async () => {
  const pool = await freshDb();
  try {
    let out = await updatePreferences({ theme: 'dark' });
    assert.equal(out.preferences.theme, 'dark');
    // Untouched keys keep their defaults.
    assert.equal(out.preferences.studentsPageSize, 25);

    // A second patch merges, it does not replace.
    out = await updatePreferences({ studentsPageSize: 50 });
    assert.equal(out.preferences.theme, 'dark');
    assert.equal(out.preferences.studentsPageSize, 50);

    // A fresh read sees the persisted, merged settings.
    const read = await getPreferences();
    assert.equal(read.preferences.theme, 'dark');
    assert.equal(read.preferences.studentsPageSize, 50);
  } finally {
    await pool.end();
  }
});

test('resetPreferences: forgets stored settings and returns defaults', async () => {
  const pool = await freshDb();
  try {
    await updatePreferences({ theme: 'light', studentsShowCode: false });
    const { preferences } = await resetPreferences();
    // The working lineage is dark-first: an unset theme falls back to 'dark'
    // (lib/preferences.js + lib/theme.js agree on this).
    assert.equal(preferences.theme, 'dark');
    assert.equal(preferences.studentsShowCode, true);

    // And it is gone from storage.
    const read = await getPreferences();
    assert.equal(read.preferences.theme, 'dark');
  } finally {
    await pool.end();
  }
});
