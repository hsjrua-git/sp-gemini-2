import path from 'node:path';
import pg from 'pg';
import { createPglitePool } from './pglite.js';

// Return PostgreSQL `date` columns (OID 1082) as raw 'YYYY-MM-DD' strings
// rather than local-midnight JS Date objects, preventing UTC timezone shifts
// in JSON responses and lexicographical string comparisons on Date.toString().
pg.types.setTypeParser(1082, (value) => value);

const databaseUrl = (process.env.DATABASE_URL ?? '').trim();
const usePglite = !databaseUrl || databaseUrl.startsWith('pglite:');

function resolvePgliteDataDir(url) {
  if (!url) {
    return path.resolve(import.meta.dirname, '../../.pglite-data');
  }
  const target = url.replace(/^pglite:(?:\/\/)?/, '').trim();
  if (!target || target === 'memory' || target === ':memory:') {
    return undefined;
  }
  return path.resolve(import.meta.dirname, '../..', target);
}

// A small, bounded pool is plenty for a single-process LAN app, and the ceiling
// protects PostgreSQL from ever seeing a runaway number of connections. When
// DATABASE_URL is unset or uses a `pglite:` URI, fall back to the embedded
// PGlite engine so the server runs self-contained without an external daemon.
const pool = usePglite
  ? createPglitePool(resolvePgliteDataDir(databaseUrl))
  : new pg.Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
    });

// A pool-level error (e.g. Postgres dropped an idle connection) would otherwise
// crash the process as an unhandled 'error' event. Log it and let the pool
// recover on the next acquire.
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

export default pool;