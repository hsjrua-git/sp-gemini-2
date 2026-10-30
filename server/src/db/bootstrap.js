import fs from 'node:fs/promises';
import path from 'node:path';
import { createUser } from '../lib/users.js';

const migrationsDir = path.join(import.meta.dirname, 'migrations');

export async function bootstrapDatabase(pool) {
  if (!pool.isPglite) return;

  await pool.ready();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = await pool.query('SELECT filename FROM schema_migrations');
  const done = new Set(applied.rows.map((row) => row.filename));

  const files = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied migration ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
    } finally {
      client.release();
    }
  }

  const userCountResult = await pool.query('SELECT count(*)::int AS count FROM users');
  if (userCountResult.rows[0].count === 0) {
    const adminRole = await pool.query(
      "SELECT id FROM roles WHERE lower(name) = 'administrator' LIMIT 1"
    );
    if (adminRole.rowCount > 0) {
      const username = (process.env.INITIAL_ADMIN_USERNAME || 'adminpanel').trim().toLowerCase();
      const password = process.env.INITIAL_ADMIN_PASSWORD || 'adminpanel';
      await createUser({
        username,
        fullName: 'Administrator',
        roleId: adminRole.rows[0].id,
        password,
        mustChangePassword: false,
        db: pool,
      });
      console.log(`Provisioned initial Administrator account "${username}".`);
    }
  }
}
