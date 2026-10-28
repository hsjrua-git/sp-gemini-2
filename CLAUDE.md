# CLAUDE.md

Guidance for working in this repository. Read this before making changes.

## Working agreement (read first)

- **Database work:** Before writing or changing any database code, inspect the
  *real* schema with the Postgres connector (list tables, describe columns,
  check indexes and constraints) — do not trust assumptions or even these docs
  for column names/types. The migrations in `server/src/db/migrations/` are the
  source of truth in the repo, but the live database is authoritative; confirm
  against it. Pull only the tables/columns you actually need.
- **Library APIs:** Before calling an unfamiliar function or configuring a
  library (Express, Helmet, express-session, react-query, react-router, Vite,
  Vitest, pg, argon2, etc.), confirm the current API with Context7 rather than
  relying on memory — several of these have had breaking changes across major
  versions (this project is on Express 5, react-router 8, react-query 5, Vite 8,
  React 19).
- **GitHub:** Use the GitHub connector for repository operations. When work is
  complete, the project should be pushed to GitHub (never commit `server/.env`
  or any real secrets — see `.gitignore`).
- **Verify your work:** run `npm run lint`, the test suites, and `npm run build`
  before considering a change done. The in-repo agents cannot always run these,
  so state clearly what was and was not verified.
- **Secrets:** never echo the contents of `server/.env` (DB password,
  `SESSION_SECRET`). Reference secrets by key name only.

## What this is

A small web app for tracking students, entering periodic scores against
configurable parameters, and reviewing results and trends. Access is controlled
by configurable roles built from fine-grained permission keys. It is designed to
run as a single Node process on a LAN (optionally behind an HTTPS reverse proxy),
with PostgreSQL for storage.

Three independently-installed packages:

- `server/` — Express 5 API, session auth, PostgreSQL access, SQL migrations, shared `core/` services.
- `client/` — React 19 + Vite single-page app (and optional Capacitor/PGlite local build).
- `agent/` — Zero-dependency Persian/English voice and text kiosk process over the server API.
- `deploy/` — systemd units, backup/restore scripts, an example reverse-proxy config.

## Tech stack

**Server** (`server/package.json`, ES modules, Node ≥ 20 for `--env-file`):
- `express@^5` — HTTP framework (async handlers auto-forward rejections; no
  `express-async-handler` needed).
- `express-session@^1` + `connect-pg-simple@^10` — sessions stored in Postgres
  (`user_sessions` table).
- `pg@^8` — PostgreSQL driver (a single shared pool, `src/db/pool.js`).
- `@electric-sql/pglite` — in-memory/WASM Postgres used by `src/core/` tests and `verify-pglite`.
- `@node-rs/argon2@^2` — password hashing.
- `helmet@^8` — security headers incl. a Content-Security-Policy.
- `express-rate-limit@^8` — login throttling.
- `morgan@^1` — request logging.
- Tests: Node's built-in `node:test` (no framework dependency).

**Client** (`client/package.json`, ES modules):
- `react@^19` + `react-dom@^19`.
- `react-router@^8` — routing (note: import from `react-router`, not
  `react-router-dom`).
- `@tanstack/react-query@^5` — all server state (fetching/caching/mutations).
- `recharts@^3` — dashboard charts (lazy-loaded into a `charts` chunk).
- `papaparse@^5` — CSV parsing for the import pages.
- `i18next@^26` + `react-i18next@^17` — bilingual UI (Persian default,
  `fa`/`en`), and `jalaali-js` for typed Jalali date entry.
- Build/dev: `vite@^8` (`@vitejs/plugin-react`). Tests: `vitest@^5` +
  `@testing-library/react` + `jsdom`. Lint: `eslint@^10` (flat config) with
  `react-hooks` and `react-refresh` plugins.

## Run / test / build commands

First-time setup and the full walkthrough live in `README.md`. Quick reference:

**Automated installer** (repo root): `setup.bat`/`setup.ps1` (Windows) and
`bash setup.sh` (Linux/macOS) bootstrap prerequisites and hand off to the
cross-platform orchestrator `scripts/setup.mjs` (checks Node/psql, creates the
DB + `server/.env` with generated secrets, installs deps, migrates, creates the
first admin, builds the client, starts the server, opens the browser). Re-runnable.

**Server** (run from `server/`):
- `npm install`
- `npm run migrate` — apply pending SQL migrations (transactional, tracked in
  `schema_migrations`). Run after any new migration file.
- `npm run dev` — API with `--watch` auto-reload, reads `server/.env`.
- `npm start` — production start (serves the built client if `client/dist` exists).
- `npm run create-user -- <username> "<Full Name>" [RoleName]` — make a user
  (prints a one-time temporary password).
- `npm run seed-sample` — seed sample data (dev only).
- `npm run reset-data` — dry run: show current row counts and what a reset would
  wipe. `npm run reset-data -- confirm` wipes to a fresh state (seeded roles +
  the Administrator account only; schema kept). Refuses if no active admin
  would remain.
- `npm test` — fast server unit tests (`node --test test/*.test.js`). The integration suite
  (`test/permissions.test.js`) is **skipped** here unless `RUN_INTEGRATION=1`.
- `npm run test:core` — PGlite-backed core service tests (`src/core/**/*.test.js`).
- `npm run verify-pglite` — verifies all SQL migrations and core invariants in PGlite.
- `npm run test-permissions` — the integration suite (sets `RUN_INTEGRATION=1`);
  needs a running server + a throwaway DB with the seeded users.

**Client** (run from `client/`):
- `npm install`
- `npm run dev` — Vite dev server; proxies `/api` to `http://localhost:3000`.
- `npm run build` — production build to `client/dist`.
- `npm run preview` — serve the built bundle locally.
- `npm run analyze` — build with the bundle-size visualizer (`ANALYZE=1`).
- `npm run lint` — ESLint over the whole client.
- `npm test` / `npm run test:watch` — Vitest (unit + component).

**Environment:** copy `server/.env.example` → `server/.env`. Required:
`DATABASE_URL`, `SESSION_SECRET` (≥32 chars). Optional: `PORT`, `HOST`,
`NODE_ENV`, `SESSION_COOKIE_SECURE`, `TRUST_PROXY`, `CSRF_CHECK_ORIGIN` — all
documented in `.env.example`.

## Server architecture (`server/src/`)

### Entry point and middleware pipeline — `index.js`

Boots the app and wires middleware **in this order** (order matters):

1. Reads and validates config: `SESSION_SECRET` (exits if missing/<32 chars),
   `SESSION_COOKIE_SECURE` (`auto`/`true`/`false`), `TRUST_PROXY`
   (hops/bool/string; default off), `CSRF_CHECK_ORIGIN` (`auto` = on only when
   `NODE_ENV=production`).
2. `helmet(...)` with an explicit CSP (`useDefaults:false`): `scriptSrc 'self'`
   (no inline/eval), `styleSrc 'self' 'unsafe-inline'`, `imgSrc 'self' data:`,
   `connectSrc 'self'`, `object-src 'none'`, `frame-ancestors 'none'`. No
   `upgrade-insecure-requests` (would break plain-HTTP LAN).
3. `morgan`, JSON + urlencoded body parsers (1 MB limit).
4. Static serving of `client/dist` when present (`serveClient`), with a SPA
   fallback at the very end that returns `index.html` for non-API GETs.
5. `/api/health` (before session — cheap unauthenticated check).
6. `session(...)` — PG-backed store, cookie `httpOnly`, `sameSite:'lax'`,
   `secure: <configured>`, `rolling`, 8 h `maxAge`, name `sid`.
7. `attachUser` — loads the user from the session onto `req.user`.
8. CSRF: `csrf.issue` (sets the readable `csrf` cookie) + `csrf.checkOrigin`
   (Origin/Referer check, only when enforced) on all `/api`.
9. `auditRequests` — records mutating requests to the audit log.
10. `/api/auth` router (login/logout/me/change-password) — mounted **before**
    `requireLogin` and `csrf.verifyToken`, so login can work without a session
    and login/logout are guarded by the Origin check only.
11. `requireLogin` → `csrf.verifyToken` → then every feature router, each
    mounted with an `authorize({ METHOD: 'permission.key' | true })` policy.
12. `/api` 404, SPA fallback, and a global error handler that hides ≥500 detail.

### Authorization model — `middleware/auth.js` + `lib/permissions.js`

- `lib/permissions.js` defines the **fixed catalogue** of permission keys
  (`PERMISSIONS`) and their `PREREQUISITES` (e.g. `scores.override` →
  `scores.enter` → `students.view` + `parameters.view`; note `scores.enter` does
  **not** require `scores.view`, enabling a "blind entry" role).
  `withPrerequisites`/`missingPrerequisites` expand and validate chosen keys.
- Roles live in the DB (`roles` + `role_permissions`); a user points at one role.
  `lib/users.js#attachPermissions` attaches `user.permissions` (array of keys).
- `authorize(policy)` maps HTTP method → required key (or `true` = any signed-in
  user). Fail-closed: unknown method → 403; `mustChangePassword` → 403 with code
  `PASSWORD_CHANGE_REQUIRED`. `HEAD` is treated as `GET`.
- `userCan(req, key)`, `requirePermission(key)`, `requireAnyPermission(...keys)`
  cover in-router checks (e.g. role list readable by users.manage OR roles.manage).

### CSRF — `middleware/csrf.js`

`createCsrf({ secure, enforceOrigin })` returns three middlewares:
- `issue` — sets a readable (`httpOnly:false`) `csrf` cookie when absent.
- `checkOrigin` — for mutating methods, rejects when a present Origin/Referer
  host ≠ `Host`. No-op when `enforceOrigin` is false (dev, where the Vite proxy
  is a different origin). Covers login/logout.
- `verifyToken` — double-submit: `X-CSRF-Token` header must equal the `csrf`
  cookie (constant-time). Mounted after `requireLogin`, so it protects every
  authenticated mutation; the client echoes the token via `api/http.js`.

### Data / DB access layer

- `db/pool.js` — one shared `pg.Pool` with bounds + timeouts (`max:10`, idle 30s,
  connect 10s, `statement_timeout` 15s) and an `error` handler so a dropped idle
  connection doesn't crash the process.
- `db/migrate.js` — applies `db/migrations/NNN_*.sql` in order inside a
  transaction, recording each in `schema_migrations`. Forward-only.
- **All SQL is parameterized (`$n`).** The only dynamic SQL is column/sort/assignment
  lists built from **server-side whitelists** (e.g. `routes/students.js` `SORTS`,
  the column maps in `parameters.js`/`users.js`/`groups.js`), never user strings.
  `LIKE` inputs are escaped. Recursive CTEs (group tree) are parameterized.
- Route handlers own their SQL; cross-cutting query helpers live in `lib/`
  (`results.js`, `groups.js`, `fields.js`, `savedViews.js`, `users.js`, etc.).
- Multi-statement writes use a checked-out client with `BEGIN`/`COMMIT`/`ROLLBACK`
  and `SELECT ... FOR UPDATE` where invariants must hold (evaluations bulk save,
  the "can't remove the last user/role manager" guards in `users.js`/`roles.js`).

### Feature routers (`routes/`) and their permission policies

Every error response carries a stable machine-readable `code` (UPPER_SNAKE,
e.g. `VALIDATION_TOO_LONG` with `params: { max }`) next to its unchanged
message — validation modules return `{ error, code, params? }` and routes
forward them; the client translates by code and falls back to the message.
When adding an error, pick or coin a code and add it to the `errors`
namespace in BOTH `client/src/i18n/{fa,en}/errors.json`.

- `auth.js` — `POST /login` (argon2 verify, dummy-hash on miss to equalize
  timing, rate-limited, `session.regenerate` on success), `POST /logout`,
  `GET /me`, `POST /change-password` (requires current password; wipes other
  sessions).
- `students.js` — CRUD + list (search/sort/paginate/group filter); restricted
  custom-field values stripped for users lacking `fields.view_restricted`.
- `parameters.js` / periods via `periods.js` + `lib/periods.js` +
  `lib/parameterUse.js` — parameters, their change history, and the period calendar.
- `evaluations.js` — `GET` (scores.view) and `PUT /evaluations/bulk`
  (scores.enter): validates, supports a `dryRun` preview (`lib/scorePreview.js`),
  lock handling + override (`lib/locks.js`), and audit of saves. Blind-entry
  users get a **redacted** preview (existing values hidden).
- `results.js` / `dashboard.js` — read-only aggregates (`lib/results.js`).
- `groups.js` + `lib/groups.js` — nested groups (cycle-prevented) and membership
  (`groups.assign` vs `groups.manage`).
- `fieldDefinitions.js` + `lib/fields.js` — custom student-field definitions and
  value validation.
- `roles.js` + `validation/role.js` — role CRUD with prerequisite enforcement.
- `users.js` + `validation/user.js` + `lib/userRules.js` — user management with
  self-protection invariants.
- `preferences.js` + `savedViews.js` — per-user prefs and saved result views
  (personal; excluded from the audit log).
- `teachers.js`, `intervals.js`, `assignments.js`, `sessions.js`, `tasks.js`,
  `taskTemplates.js`, `alerts.js` — scheduling, teacher roster, generated/manual
  sessions, student/group tasks, and academic/attendance alerts.
- `export.js` + `lib/exportCube.js` — Export Center cube builder (gated by
  `data.export` AND `scores.view`).
- `audit.js` — read the audit log (filter by category/actor, paginated); writes
  come from `middleware/audit.js` + `lib/audit.js` (+ `lib/auditRules.js` which
  redacts secret-like keys and decides what is recorded).
- `cafe*.js` — the cafe module. Money is **bigint Toman** everywhere;
  quantities `numeric(12,3)`. `cafe_products`/`cafe_suppliers` (022,
  deactivate-not-delete); purchases + an **append-only** `cafe_stock_movements`
  ledger (023, UPDATE/DELETE refused by trigger; stock = SUM(qty); the
  moving-average `avg_cost` is maintained transactionally by
  `lib/cafeStock.js`); sales + prepaid `student_balances` with
  **overdraft allowed** (024 — a charge may push the balance negative; the
  `student_balance_transactions` history keeps `balance_after` so it replays;
  sales VOID — stock back, balance refunded — never delete, see
  `lib/cafeSale.js`/`lib/cafeBalance.js`); waste (valued at avg cost) and
  sign-carrying adjustments (`cafeInventory.js`); aggregates in
  `lib/cafeReports.js`. Permissions `cafe.view/sell/balance/supplies/
  inventory/manage` (each → `cafe.view`); `cafe.sell` deliberately needs no
  `students.view` — the POS sees only name/code/balance via
  `/api/cafe/balances/students` (the blind-entry precedent). All money-moving
  writes are single transactions audited in-route; rolled-back live smokes in
  `src/scripts/cafe*Smoke.mjs` cover the ledger math.
- `accounting*.js` — the accounting module on top of the same bigint-Toman
  money convention. 025/026 seed a simplified accrual chart of accounts
  (Persian names), fiscal periods, the journal, the `acct_mappings`
  cafe-to-journal map, the accounting permission ladder
  (`accounting.view -> enter -> post -> close`, plus `manage`) and a seeded
  Accountant role. Database-enforced invariants (025): sigma-debit =
  sigma-credit per entry by a DEFERRED constraint trigger at COMMIT; posted
  entries are immutable — only the exact void transition passes, lines
  touch drafts only, corrections are new reversing entries; nothing posts
  into a closed period; one posted entry per source event (voiding frees
  the slot). `lib/accountingJournal.js` is the engine (draft/post/void,
  mapped auto-posts, the once-ever opening entry, period close with the
  automatic closing entry into retained earnings);
  `lib/accountingReports.js` builds trial balance / general ledger /
  income statement / balance sheet over POSTED lines (the sheet returns
  its identity check). Cafe transactions auto-post INSIDE their own
  transactions (sale revenue+COGS, purchase, manual top-ups/refunds, waste
  at the current average cost; voiding a sale voids its entry) —
  deactivating a mapping pauses that event and the cafe keeps working
  standalone. Live rolled-back smoke: `src/scripts/accountingSmoke.mjs`.

- `agent/` — the voice kiosk implementation (Phase 5): a separate
  zero-dependency Node process that runs the cafe by voice/text as a machine
  user in the `Kiosk` role, bilingual fa/en, with the confirmation protocol
  enforced in dialogue.js. See `agent/README.md` and
  `docs/voice-agent-architecture.md`.
- `docs/voice-agent-architecture.md` — the approved design for a
  fully-local Persian voice agent over the existing API (machine users,
  confirmation protocol, staged rollout). No code depends on it yet; read
  it before any kiosk work.

### Scripts and tests

- `scripts/createUser.js`, `scripts/seedSample.js`.
- `test/*.test.js` — `node:test` unit tests over the pure logic (permissions,
  locks, results, imports, score preview, periods, validation) plus
  `authMiddleware.test.js` and `csrf.test.js`. `permissions.test.js` is the
  end-to-end integration suite (gated behind `RUN_INTEGRATION`).

## Client architecture (`client/src/`)

### Entry and providers

- `main.jsx` — creates the `QueryClient` (defaults: `staleTime` 30s, `gcTime`
  5 min, `refetchOnWindowFocus:false`, no-retry on network errors; a
  `QueryCache`/`MutationCache` `onError` signs the user out on 401), applies the
  remembered theme, and mounts the tree: `QueryClientProvider` → `ErrorBoundary`
  → `BrowserRouter` → `AuthProvider` → `PreferencesProvider` → `App`.
- `auth/` — `AuthProvider.jsx` holds the provider; `AuthContext.jsx` exports the
  context + `useAuth` (kept split so the many `useAuth` importers are stable and
  to satisfy `react-refresh/only-export-components`). `useAuth` exposes
  `user`, `isLoading`, `loadError`, `can(key)`, `login`, `logout`. `user` comes
  from `GET /api/auth/me` (query key `['me']`).
- `preferences/` — same split (`PreferencesProvider.jsx` + `PreferencesContext.jsx`);
  per-user preferences (theme, palette, sort, `language`, etc.) with optimistic
  updates.
- `i18n/` — bilingual foundation, **Persian default**. Locale JSON files live in
  `i18n/{fa,en}/*.json` (one namespace per file: `common`, `nav`, `errors`,
  plus one per page group) and are auto-registered via `import.meta.glob` —
  adding translations means dropping in JSON, nothing else. A Vitest parity
  test keeps both languages' key trees identical. Language state mirrors the
  theme: a localStorage draft applied at boot (login screen starts Persian),
  the stored per-user preference once signed in, and `<html lang/dir>` stays
  in sync (`setLanguage` in `i18n/index.js` is the single switch). Errors
  render through `errorMessage()` (`i18n/errors.js`), which translates by the
  server's machine-readable `code` (catalogue in the `errors` namespace) and
  falls back to the server message. `lib/locale.js` renders Jalali dates via
  `Intl` (`fa-IR-u-ca-persian`), converts digits both ways, and backs
  `components/JalaliDatePicker.jsx` (Gregorian + Jalali input side by side;
  the value stays ISO). `lib/format.js` is locale-aware through it — full
  dates show BOTH calendars. Vazirmatn (self-hosted, `assets/fonts/`) leads
  the font stack under `[lang='fa']`; `--font-numeric` stays Manrope-first so
  tables keep lining Latin digits. The stylesheet uses logical properties
  (`inline-start/end`, `text-align: start/end`) with explicit `[dir='rtl']`
  overrides where a transform is physical (drawers).

### Routing and auth gating — `App.jsx`, `components/RequireAuth.jsx`, `components/Layout.jsx`

- `App.jsx` — `LoginPage` is eager; **every other page is `React.lazy`**. Routes
  nest under `<RequireAuth>` → `<Layout>`. The `<Suspense>` boundary for the
  lazy pages lives in `Layout` around `<Outlet/>`.
- `RequireAuth.jsx` — shows loading/error, redirects to `/login` when signed
  out, and forces `/change-password` when `user.mustChangePassword`.
- `Layout.jsx` — the app shell: a two-level, permission-filtered sidebar
  (`NAV_PANELS` + `NAV_ITEMS` in `lib/navigation.js`, with a collapsible desktop
  icon rail and a pinned `sidebar-account` footer for Preferences / Change
  password / Sign out), a topbar with the page title, and a mobile drawer
  (matchMedia, focus trap, Escape, `inert` when closed).

### Server state — `api/` + react-query

- `api/http.js` — the single `fetch` wrapper: shapes errors (adds `.status`,
  `.data`), defaults JSON content type (skipped for `FormData`), and echoes the
  `X-CSRF-Token` header (read from the `csrf` cookie) on mutating requests.
- `api/*.js` — thin per-resource functions (`students`, `parameters`,
  `evaluations`, `results`, `dashboard`, `users`, `roles`, `groups`, `fields`,
  `preferences`, `savedViews`, `audit`, `periods`, `auth`) that call `request()`.
- Pages call these through `useQuery`/`useMutation`. Mutations invalidate the
  affected query keys on success (e.g. saving scores invalidates
  `['evaluations']`, `['results']`, `['trends']`). `usePeriods` overrides
  `staleTime` to 30 min (near-static).

### Pages and components

- `pages/` — one component per route (`DashboardPage`, `StudentsPage`,
  `StudentDetailPage`, `TeachersPage`, `SchedulePage`, `SessionsPage`,
  `EvaluatePage`, `ParametersPage`, `ResultsPage`, `ExportPage`,
  `ImportStudentsPage`, `ImportScoresPage`, `CafeSalesPage`,
  `CafeProductsPage`, `CafePurchasesPage`, `CafeInventoryPage`,
  `CafeReportsPage`, `AccountingJournalPage`, `AccountingAccountsPage`,
  `AccountingPeriodsPage`, `AccountingReportsPage`, `AgentPage`,
  `AgentTranscriptsPage`, `UsersPage`, `RolesPage`, `GroupsPage`,
  `FieldsPage`, `PreferencesPage`, `ChangePasswordPage`, `AuditPage`,
  `LoginPage`, `NotFoundPage`).
- `components/` — shared UI: forms (`StudentForm`, `UserForm`, `ParameterForm`),
  tables/rows, `EvaluationGrid` (memoized `EvaluationRow` + `rowsEqual` so a
  keystroke re-renders only its row), `GroupFilter`, `ConnectionBanner`,
  `ErrorBoundary`, `PageLoader`, chart views, etc.
- `lib/` — pure helpers, unit-tested alongside `src/**/*.test.{js,jsx}`:
  `cells.js` (score parse/validate/save payload), `resultsView.js`
  (filter/sort/stats), `dashboard.js` (aggregates), `csv.js` (CSV build with
  formula-injection guard), `scoreImport.js`/`importNames.js` (import parsing),
  `format.js`, `numbers.js`, `theme.js`, `studentFields.js`,
  `useDebouncedValue.js`, `usePeriods.js`.
- `index.css` — one token-based stylesheet. Light + dark theming via
  `:root` / `:root[data-theme='dark']` / `prefers-color-scheme` on
  `data-theme='system'`. Soft transitions gated behind
  `prefers-reduced-motion`. All class names are shared here (no CSS modules).

## Client ↔ server data flow

1. Browser loads the SPA (in prod from the same Node process; in dev from Vite,
   which proxies `/api` → `:3000`).
2. `AuthProvider` calls `GET /api/auth/me`. That response also sets the `csrf`
   cookie (via the server's `issue` middleware) so it exists before login.
3. The user logs in (`POST /api/auth/login`) → server verifies argon2, regenerates
   the session, returns the user (with `permissions`). The `sid` session cookie
   is set.
4. Pages fetch data through `api/*` + react-query. The session cookie authenticates
   each request; the server re-derives `req.user`/permissions per request.
5. Mutations send `X-CSRF-Token`; the server checks it (and Origin in prod),
   authorizes by permission key, writes (transactionally where needed), and
   audits. The client invalidates affected query keys.
6. The client's `can(key)` only hides/shows UI — **the server enforces every
   permission**; the UI is a convenience, the API is the gate.

## Security posture (where to look)

- AuthN: argon2 (`lib/passwords.js`), login rate limit + timing equalization
  (`routes/auth.js`), session regeneration, eviction of deactivated users.
- AuthZ: fixed permission catalogue + fail-closed `authorize` (`middleware/auth.js`,
  `lib/permissions.js`); server-side enforcement on every route.
- CSRF: double-submit token + Origin check (`middleware/csrf.js`).
- Headers/CSP: `helmet` in `index.js`.
- Cookies/TLS: `SESSION_COOKIE_SECURE` + `TRUST_PROXY`; HTTPS via reverse proxy
  (`deploy/Caddyfile.example`, README).
- SQL: parameterized everywhere; dynamic parts are whitelists.
- Secrets: `SESSION_SECRET` validated at boot; audit log redacts secret-like keys.

## Conventions

- ES modules everywhere; `.jsx` for React components, `.js` for logic/helpers.
- Keep business logic in `lib/` (pure, testable) and I/O in routes/components.
- Match existing patterns: parameterized SQL + whitelists, permission-keyed
  routes, react-query for all server state, one CSS file with shared class names.
- Prefer adding a `node:test`/Vitest test alongside non-trivial logic.
- Don't introduce `react-router-dom` (this project uses `react-router` v8),
  browser storage in place of react state, or unparameterized SQL.
