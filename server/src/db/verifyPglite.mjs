// Phase 1 de-risk: prove the existing Postgres migrations (001-015) apply cleanly
// on PGlite (Postgres-in-WASM), and that core runtime behaviour the app relies on
// — gen_random_uuid(), now() defaults, CHECK constraints, lower()/partial unique
// indexes, the seeded roles and the migration-015 permission tweak — works too.
//
// Runs against a FRESH IN-MEMORY database every time (no dataDir), so it never
// touches any real data and can be re-run freely.
//
//   node server/src/db/verifyPglite.mjs
//
// Exit code 0 = everything passed; 1 = something failed (details printed above).

import fs from 'node:fs/promises';
import path from 'node:path';
import { createPglitePool } from './pglite.js';
import { counts as resetCounts, reset as runResetData } from '../scripts/resetData.js';

const migrationsDir = path.join(import.meta.dirname, 'migrations');

const pass = (msg) => console.log(`  ✓ ${msg}`);
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};

// Assert that a query rejects (used to prove CHECK / unique constraints fire).
async function expectReject(pool, label, sql, params) {
  try {
    await pool.query(sql, params);
    fail(`${label} — expected a constraint error, but the statement succeeded`);
  } catch {
    pass(`${label} — correctly rejected`);
  }
}

async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  console.log(`Applying ${files.length} migration(s) on PGlite:`);
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql); // multi-statement -> routed through PGlite exec()
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      pass(`applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      fail(`failed on ${file}: ${err.message}`);
      throw err; // stop the run; later migrations depend on earlier ones
    } finally {
      client.release();
    }
  }
}

const num = (result) => Number(result.rows[0].count);

async function runSanityChecks(pool) {
  console.log('\nRuntime sanity checks:');

  // gen_random_uuid() default + now() default on insert.
  const inserted = await pool.query(
    `INSERT INTO students (student_code, full_name)
     VALUES ('23456789', 'Test Student')
     RETURNING id, created_at`,
  );
  const { id, created_at: createdAt } = inserted.rows[0];
  if (/^[0-9a-f-]{36}$/i.test(id)) pass(`gen_random_uuid() produced a uuid (${id})`);
  else fail(`gen_random_uuid() returned an unexpected id: ${id}`);
  if (createdAt) pass('now() default populated created_at');
  else fail('created_at was not defaulted');

  // CHECK constraints fire (invalid code has forbidden chars; regex must reject).
  await expectReject(
    pool,
    'student_code_format CHECK',
    `INSERT INTO students (student_code, full_name) VALUES ('00000000', 'Bad Code')`,
  );

  // Seeded roles from migrations 010, 026 (Accountant), and 027 (Kiosk).
  const roleCount = num(await pool.query(`SELECT COUNT(*)::int AS count FROM roles`));
  if (roleCount === 5) pass('five system roles seeded (Administrator, Staff, Viewer, Accountant, Kiosk)');
  else fail(`expected 5 seeded roles, found ${roleCount}`);

  // Migration 015: Viewer lost data.export; Staff kept it.
  const viewerExport = num(
    await pool.query(
      `SELECT COUNT(*)::int AS count FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       WHERE lower(r.name) = 'viewer' AND rp.permission_key = 'data.export'`,
    ),
  );
  const staffExport = num(
    await pool.query(
      `SELECT COUNT(*)::int AS count FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       WHERE lower(r.name) = 'staff' AND rp.permission_key = 'data.export'`,
    ),
  );
  if (viewerExport === 0) pass('migration 015 removed data.export from Viewer');
  else fail('Viewer still has data.export after migration 015');
  if (staffExport === 1) pass('Staff retains data.export');
  else fail(`Staff data.export missing (found ${staffExport})`);

  // Partial unique index on live top-level group names (lower()) + self-parent CHECK.
  const alphaGroup = await pool.query(
    `INSERT INTO student_groups (name, code) VALUES ('Alpha', 'alpha-1') RETURNING id`,
  );
  await expectReject(
    pool,
    'student_groups top-level name unique index',
    `INSERT INTO student_groups (name, code) VALUES ('alpha', 'alpha-2')`,
  );
  await expectReject(
    pool,
    'student_groups group_not_own_parent CHECK',
    `UPDATE student_groups SET parent_id = $1 WHERE id = $1`,
    [alphaGroup.rows[0].id],
  );

  // Fiscal period overlap trigger from migration 030.
  await pool.query(
    `INSERT INTO acct_fiscal_periods (name, start_date, end_date)
     VALUES ('FY 1404', '2025-03-21', '2026-03-20')`,
  );
  await expectReject(
    pool,
    'acct_fiscal_periods overlap trigger',
    `INSERT INTO acct_fiscal_periods (name, start_date, end_date)
     VALUES ('Overlap FY', '2026-01-01', '2026-06-01')`,
  );

  // lower(username) unique index on users (needs a real role_id, NOT NULL).
  const adminId = (
    await pool.query(`SELECT id FROM roles WHERE lower(name) = 'administrator'`)
  ).rows[0].id;
  const staffId = (
    await pool.query(`SELECT id FROM roles WHERE lower(name) = 'staff'`)
  ).rows[0].id;
  await pool.query(
    `INSERT INTO users (username, full_name, password_hash, role_id)
     VALUES ('coach', 'Coach', 'x', $1)`,
    [adminId],
  );
  await expectReject(
    pool,
    'users username unique index',
    `INSERT INTO users (username, full_name, password_hash, role_id)
     VALUES ('coach', 'Coach Two', 'x', $1)`,
    [adminId],
  );

  // Verify resetData wipes non-admin users even when they created cafe/accounting records.
  const staffUser = await pool.query(
    `INSERT INTO users (username, full_name, password_hash, role_id)
     VALUES ('staff1', 'Staff One', 'x', $1) RETURNING id`,
    [staffId],
  );
  const prod = await pool.query(
    `INSERT INTO cafe_products (name, unit, sale_price) VALUES ('Tea', 'cup', 10000) RETURNING id`,
  );
  await pool.query(
    `INSERT INTO cafe_stock_movements (product_id, kind, qty, unit_cost, created_by)
     VALUES ($1, 'adjustment', 5, 5000, $2)`,
    [prod.rows[0].id, staffUser.rows[0].id],
  );
  const removedUsers = await runResetData(pool);
  const afterReset = await resetCounts(pool);
  if (removedUsers === 1 && afterReset.users === 1 && afterReset.intervals === 4) {
    pass('resetData cleanly wiped domain/ledger rows, removed non-admin user, and re-seeded intervals');
  } else {
    fail(`resetData unexpected state: removed=${removedUsers}, after=${JSON.stringify(afterReset)}`);
  }
}

async function main() {
  const pool = createPglitePool(); // in-memory, fresh
  await pool.ready();
  try {
    await runMigrations(pool);
    await runSanityChecks(pool);

    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    console.log(`\nTables created (${tables.rows.length}):`);
    console.log('  ' + tables.rows.map((r) => r.table_name).join(', '));
  } catch {
    // Migration failure already reported; fall through to the summary.
  } finally {
    await pool.end();
  }

  console.log('');
  if (failures === 0) {
    console.log('RESULT: PASS — all migrations applied and every sanity check passed on PGlite.');
    process.exitCode = 0;
  } else {
    console.log(`RESULT: FAIL — ${failures} check(s) failed. See ✗ lines above.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Verification crashed:', err);
  process.exitCode = 1;
});
