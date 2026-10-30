// Block API work before session/auth SQL when the deployed schema is behind.
// This is read-only: migrations remain an explicit maintenance operation.
export function createDatabaseReadiness({ pool, migrations, cacheMs = 5000, now = Date.now }) {
  let cached;
  let checkedAt = -Infinity;
  let inFlight;

  async function inspect() {
    try {
      let rows;
      try {
        ({ rows } = await pool.query('SELECT filename FROM schema_migrations'));
      } catch (error) {
        if (error.code !== '42P01') throw error;
        rows = [];
      }
      const applied = new Set(rows.map(({ filename }) => filename));
      const pending = migrations.filter(filename => !applied.has(filename));
      if (pending.length) {
        return {
          ok: false, database: 'ok', schema: 'outdated',
          code: 'DATABASE_MIGRATIONS_PENDING',
          error: 'Database upgrade required. Run npm run migrate from server/ and retry.',
          pendingMigrations: pending.length,
        };
      }
      return { ok: true, database: 'ok', schema: 'ok' };
    } catch {
      return {
        ok: false, database: 'unavailable', schema: 'unknown',
        code: 'DATABASE_UNAVAILABLE',
        error: 'The database is unavailable. Check the database service and server configuration.',
      };
    }
  }

  async function check({ refresh = false } = {}) {
    if (inFlight) return inFlight;
    if (!refresh && cached && now() - checkedAt < cacheMs) return cached;
    inFlight = inspect().then(status => {
      cached = status;
      checkedAt = now();
      return status;
    }).finally(() => { inFlight = undefined; });
    return inFlight;
  }

  return {
    check,
    async health(req, res) {
      const status = await check({ refresh: true });
      res.set('Cache-Control', 'no-store');
      res.status(status.ok ? 200 : 503).json(status);
    },
    async requireReady(req, res, next) {
      const status = await check();
      if (status.ok) return next();
      res.set('Cache-Control', 'no-store');
      res.status(503).json(status);
    },
  };
}
