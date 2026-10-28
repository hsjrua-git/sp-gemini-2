// Browser database bootstrap — the on-device equivalent of `npm run migrate`.
//
// The desktop app has PostgreSQL and server/src/db/migrate.js. The single-user
// mobile build has neither a server nor a filesystem: the database is a single
// PGlite (Postgres-in-WASM) instance living in the browser/webview, persisted to
// IndexedDB. This module stands PGlite up, applies any pending migrations, wires
// it into the shared service layer via initDb(), and seeds the local admin.
//
// It reuses the SAME adapter, migration files, and bootstrap the server uses —
// nothing is duplicated. Migrations are inlined at build time by Vite's
// import.meta.glob (there is no fs at runtime), then applied with the exact
// CREATE/SELECT/BEGIN/INSERT/COMMIT sequence migrate.js uses, so the schema on
// device is identical to the desktop schema.

import { createPglitePool } from '@server/db/pglite.js';
import { initDb } from '@server/core/db.js';
import { ensureLocalUser } from '@server/core/bootstrap.js';

// Persisted PGlite store. `idb://` keeps the whole database in IndexedDB, so it
// survives reloads and app restarts on the device.
const DATA_DIR = 'idb://student-panel';

// Every migration's SQL text, bundled at build time as raw strings. Keys are the
// source file paths; values are the file contents. `eager` inlines them so no
// dynamic import (and no network/fs) happens at runtime.
const migrationModules = import.meta.glob(
  '../../../server/src/db/migrations/*.sql',
  { query: '?raw', import: 'default', eager: true },
);

// [{ filename, sql }] ordered by filename. Migrations are named with a
// zero-padded NNN_ prefix, so a plain lexicographic sort is the correct order.
const migrations = Object.entries(migrationModules)
  .map(([path, sql]) => ({ filename: path.split('/').pop(), sql }))
  .sort((a, b) => a.filename.localeCompare(b.filename));

// Apply pending migrations. Idempotent: each applied file is recorded in
// schema_migrations, so a second run (or a returning user) does nothing.
async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = await pool.query('SELECT filename FROM schema_migrations');
  const done = new Set(applied.rows.map((row) => row.filename));

  for (const { filename, sql } of migrations) {
    if (done.has(filename)) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [
        filename,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${filename} failed: ${err.message}`, {
        cause: err,
      });
    } finally {
      client.release();
    }
  }
}

// Single-flight init: created once, reused by every caller (guards React
// StrictMode's double-invoke and any accidental second call).
let initPromise = null;

// Stand up the on-device database and make the service layer usable. Resolves to
// the pool once migrations have run, initDb() is wired, and the local admin is
// seeded. Call (and await) this once before rendering the app.
export function initLocalDb() {
  if (!initPromise) {
    initPromise = (async () => {
      const pool = createPglitePool(DATA_DIR);
      await pool.ready();
      await runMigrations(pool);
      initDb(pool);
      await ensureLocalUser(pool);
      return pool;
    })();
  }
  return initPromise;
}
