// The one database handle the service layer talks to.
//
// The Express server imported a shared `pool` singleton (src/db/pool.js) and
// every route used it directly. The on-device build has exactly one database
// too — a single PGlite instance — so we mirror that pattern: the app calls
// initDb(pool) once at startup, and services call getDb() at the point of use.
//
// `pool` here is anything with the pg-Pool-compatible surface the services
// need: `.query(text, params)` -> { rows, rowCount } and `.connect()` ->
// { query, release }. In production that's the PGlite adapter (src/db/pglite.js
// #createPglitePool). In tests it's the same adapter over a fresh in-memory
// database, so the exact same code path is exercised.

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
