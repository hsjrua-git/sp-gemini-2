// The one database handle the service layer talks to.
//
// The Express server imported a shared `pool` singleton (src/db/pool.js) and
// every route used it directly. The framework-free test mirror uses one PGlite
// instance and mirrors that pattern: tests call initDb(pool), then services call
// getDb() at the point of use.
//
// `pool` here is anything with the pg-Pool-compatible surface the services
// need: `.query(text, params)` -> { rows, rowCount } and `.connect()` ->
// { query, release }. Here it is the PGlite adapter (src/db/pglite.js) over a
// fresh in-memory database. Production uses src/db/pool.js and Express routes.

let db = null;

// Wire up the database handle. Call once during startup (and once per test,
// with a throwaway in-memory pool). Returns the handle for convenience.
export function initDb(pool) {
  db = pool;
  return db;
}

// The active database handle. Throws if the app forgot to initialise it, which
// is a programming error rather than something the user can cause.
export function getDb() {
  if (db === null) {
    throw new Error('Database not initialised — call initDb(pool) at startup.');
  }
  return db;
}

// Mostly for tests that spin up and tear down repeatedly.
export function resetDb() {
  db = null;
}
