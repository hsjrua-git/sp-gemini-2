import { PGlite } from '@electric-sql/pglite';

// A pg-Pool-compatible facade over a single PGlite (Postgres-in-WASM) connection.
//
// The framework-free core test mirror expects the same three pool operations:
//   - pool.query(text, params) -> { rows, rowCount }
//   - pool.connect() -> client with .query()/.release() for BEGIN/COMMIT/ROLLBACK
//   - pool.end()
// This module reproduces that surface on top of PGlite for migration and core
// tests. It is not used by the connected Capacitor client. PGlite is one connection,
// so connect() serialises callers through a mutex to mirror pg handing out an
// isolated client for the duration of a transaction.

// Minimal async mutex: acquire() resolves to a release() function; the next
// acquire() waits until that release() is called.
class Mutex {
  #tail = Promise.resolve();

  acquire() {
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const previous = this.#tail;
    this.#tail = previous.then(() => next);
    return previous.then(() => release);
  }
}

// pg exposes rowCount; PGlite exposes affectedRows (for INSERT/UPDATE/DELETE) and
// rows (for SELECT). Prefer affectedRows when the statement changed rows, else
// fall back to the number of rows returned. This matches every rowCount check in
// the codebase (SELECT ... LIMIT 1 existence checks, UPDATE/DELETE counts).
function rowCountFor(result) {
  if (result && typeof result.affectedRows === 'number' && result.affectedRows > 0) {
    return result.affectedRows;
  }
  return result && Array.isArray(result.rows) ? result.rows.length : 0;
}

function shape(result) {
  return {
    rows: result?.rows ?? [],
    rowCount: rowCountFor(result),
    fields: result?.fields ?? [],
  };
}

// Run one call the way pg would: with params it's a single parameterised
// statement (extended protocol -> db.query); without params it may be a bare or
// multi-statement string (simple protocol -> db.exec, whose result is an array).
async function run(db, text, params) {
  if (params === undefined) {
    const results = await db.exec(text);
    const last = Array.isArray(results) ? results[results.length - 1] : results;
    return shape(last);
  }
  return shape(await db.query(text, params));
}

export function parsePgInterval(raw) {
  if (raw && typeof raw === 'object') return raw;
  const result = {};
  const names = {
    year: 'years', years: 'years',
    mon: 'months', mons: 'months', month: 'months', months: 'months',
    day: 'days', days: 'days',
  };
  for (const match of String(raw ?? '').matchAll(
    /(-?\d+(?:\.\d+)?)\s+(years?|mons?|months?|days?)/gi
  )) {
    result[names[match[2].toLowerCase()]] = Number(match[1]);
  }
  const time = String(raw ?? '').match(/([+-])?(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (time) {
    const sign = time[1] === '-' ? -1 : 1;
    result.hours = sign * Number(time[2]);
    result.minutes = sign * Number(time[3]);
    result.seconds = sign * Number(time[4]);
  }
  return result;
}

export function createPglitePool(dataDir) {
  // No dataDir => in-memory (used by verification/core tests). A path is still
  // accepted for focused tooling, but no shipped client persists PGlite.
  // Align OID 1082 (date -> 'YYYY-MM-DD') and OID 1186 (interval -> object)
  // with node-pg so route/service code behaves identically on both drivers.
  const parsers = {
    1082: (value) =>
      value instanceof Date
        ? value.toISOString().slice(0, 10)
        : String(value ?? '').slice(0, 10),
    1186: parsePgInterval,
  };
  const db =
    dataDir && typeof dataDir === 'object'
      ? new PGlite({ ...dataDir, parsers: { ...parsers, ...dataDir.parsers } })
      : dataDir
        ? new PGlite(dataDir, { parsers })
        : new PGlite({ parsers });
  if (db.parsers) {
    Object.assign(db.parsers, parsers);
  }
  const mutex = new Mutex();

  return {
    // Exposed so scripts can await readiness / inspect the raw instance.
    _db: db,
    async ready() {
      await db.waitReady;
      if (db.parsers) {
        Object.assign(db.parsers, parsers);
      }
      return this;
    },
    query(text, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = undefined;
      }
      const promise = run(db, text, params);
      if (typeof callback === 'function') {
        promise.then(
          (result) => callback(null, result),
          (err) => callback(err)
        );
      }
      return promise;
    },
    async connect() {
      const release = await mutex.acquire();
      let released = false;
      return {
        query(text, params, callback) {
          if (typeof params === 'function') {
            callback = params;
            params = undefined;
          }
          const promise = run(db, text, params);
          if (typeof callback === 'function') {
            promise.then(
              (result) => callback(null, result),
              (err) => callback(err)
            );
          }
          return promise;
        },
        release() {
          if (released) return;
          released = true;
          release();
        },
      };
    },
    // pg pools emit 'error' for dropped backend connections; PGlite is in-process
    // and has no such event, so on() is a no-op kept for interface parity.
    on() {
      return this;
    },
    async end() {
      await db.close();
    },
  };
}

export default createPglitePool;
