# Audit Remediation & Changes Report

> **Historical report.** This was the earlier remediation pass and contains
> superseded period/permission claims. The independent final audit and current
> verification record are in
> [`audit-2026-10-28-sp-gemini-1-opencode.md`](audit-2026-10-28-sp-gemini-1-opencode.md)
> and [`schema-4-adaptation.md`](schema-4-adaptation.md).

This document records every bug fix, schema/trigger hardening, UI/state fix, security improvement, and cleanup applied across `server/`, `client/`, `agent/`, `deploy/`, and project documentation following the full repository audit (`docs/audit-notes.md`) and runtime error analysis. It also documents what was intentionally left untouched (or could not be executed in the container environment) and why.

---

## 1. Summary of What Was Done

1. **Fixed Preview Redirect Loop (`history.replaceState` Error)**: Resolved the rapid unauthenticated redirect/animation loop on `/login` in `client/src/App.jsx` and `client/src/components/RequireAuth.jsx`.
2. **Normalized PostgreSQL `date` & `interval` Types End-to-End**: Configured `pg` and `PGlite` type parsers (`OID 1082` for `date`, `OID 1186` for `interval`), normalized date sorting in `assignPeriods()`, added explicit `::text` casts across all SQL queries returning `date` columns, and normalized `{ years }` / string intervals in `SchedulePage.jsx`.
3. **Fixed Multi-Session Period Aggregation & Results Ordering**: Fixed `buildResults()` on the server and `periodView()` / `periodCellMap()` on the client so multi-session periods aggregate chronologically without `null` values overwriting earlier non-null scores or ignoring later sessions in the same period.
4. **Hardened Accounting & Cafe Ledgers (Migration `030_audit_fixes.sql` + Service Logic)**:
   - Prevented voiding closing entries (`source_type = 'closing'`) and entries inside closed fiscal periods at both the DB trigger level (`030_audit_fixes.sql`) and application layer (`accountingJournal.js`).
   - Checked `voidEntry()` return values inside `voidSale()` so cafe sales in closed fiscal periods cannot be voided while leaving their accounting entry posted.
   - Handled negative revenue/expense balances (contra accounts / refunds) and >100-line closing entries in `closeFiscalPeriod()`.
   - Excluded soft-deleted students (`deleted_at IS NULL`) from `generateOpeningEntry()` and cafe debtor reports (`getRangeReport()`).
   - Added missing audit logging and `409 Conflict` handling for `POST /api/accounting/periods/opening` and closed-period cafe writes.
5. **Fixed Permissions, Alerts, Tasks, Audit Categories, & Seed/Verification Scripts**:
   - Added `schedule.view` as a prerequisite for `scores.view`, `scores.enter`, and `data.export` (both in `lib/permissions.js` and backfilled in `030_audit_fixes.sql`).
   - Excluded sessions that already have non-null active evaluations from `missing_scores` alerts (`lib/alerts.js`).
   - Updated `DELETE /api/tasks/:id` to bump `sessions.updated_at` inside a transaction (`routes/tasks.js` and `core/services/tasks.js`).
   - Synchronized audit categories and bilingual (`fa`/`en`) labels across server and client for all `cafe_*` and `accounting_*` actions.
   - Fixed `routes/agent.js` transcript matching (`s.note = 'voice' OR s.note LIKE 'voice:%'`), `seedSample.js --remove` cleanup order, and `verifyPglite.mjs` imports.
6. **Fixed Client UI, React Query Cache Invalidation, & Orphaned Tests**:
   - Fixed `DashboardPage.jsx` calling `update.mutate(...)` instead of `update(...)`.
   - Enabled custom student fields (`StudentFieldInputs`) during student creation (`StudentForm.jsx`), formatted `date` custom fields via `formatIsoDate`, and invalidated `['students']` on save (`StudentFieldsSection.jsx`).
   - Fixed `GroupsPage.jsx` past-members key uniqueness (`s.membershipId ?? s.id`) and Jalali/Gregorian date formatting (`formatIsoDate(s.leftOn)`).
   - Added missing React Query cache invalidations in `StudentBalanceSection.jsx` and `CafeSalesPage.jsx`.
   - Fixed longest-prefix active route matching in the collapsed desktop icon rail (`Layout.jsx`).
   - Removed all 12 obsolete pre-Vitest test files in `client/test/`.
7. **Hardened Voice Agent (`agent/`) & Deployment Scripts (`deploy/`)**:
   - Fixed `dialogue.js` stage-gate deadlocks on failed sales and added missing `publishState()` broadcasts.
   - Guarded `findProduct()` against empty strings, reset confirmation gates on cart/customer mutations, and switched `todayIso()` to `Asia/Tehran` in `agent/src/tools.js`.
   - Added `tool_call_id` to tool response messages in `agent/src/llm.js`.
   - Eliminated arbitrary shell sourcing of `server/.env` in `deploy/backup.sh`, `deploy/restore.sh`, and `deploy/student-panel-backup.service`, added atomic backup writes with `umask 077`, transactional restores (`--single-transaction -v ON_ERROR_STOP=1`), and systemd security hardening.

---

## 2. Detailed File-by-File Changes

### 2.1 Preview Redirect & Route Animation Fix
- **`client/src/components/RequireAuth.jsx`**
  - Stabilized the unauthenticated redirect `<Navigate to="/login" state={{ from: { pathname: location.pathname, search: location.search } }} replace />` so passing `location` does not nest mutating router state objects and trigger repeated `history.replaceState` calls.
- **`client/src/App.jsx`**
  - Updated `AnimatedRoutes` to skip WAAPI `.animate()` calls when transitioning to or from `/login` or when `#main-content` is absent.

### 2.2 PostgreSQL Date (`OID 1082`) & Interval (`OID 1186`) Normalization
- **`server/src/db/pool.js`**
  - Registered `pg.types.setTypeParser(1082, (value) => String(value))` so PostgreSQL `date` columns always serialize as `'YYYY-MM-DD'` strings rather than timezone-shifted JS `Date` instances.
- **`server/src/db/pglite.js`**
  - Registered type parsers for `OID 1082` (`date -> 'YYYY-MM-DD'`) and `OID 1186` (`interval -> { years, months, days }`) in `createPglitePool()`, handling both `new PGlite({ parsers })` (when `dataDir` is omitted) and `Object.assign(db.parsers, parsers)` after `db.waitReady`.
- **`server/src/lib/periods.js`**
  - Normalized `s.sessionDate` via `isoDate(s.sessionDate)` in `assignPeriods()` so `Date` objects and ISO strings sort chronologically rather than lexicographically by weekday name (`"Fri..." < "Mon..."`).
- **Explicit `::text` SQL casts on `date` columns**:
  - `server/src/routes/sessions.js` & `server/src/core/services/sessions.js`: `planned_date::text`, `moved_to::text AS "movedToDate"`, `session_date::text`.
  - `server/src/routes/students.js` & `server/src/core/services/students.js`: `birth_date::text`.
  - `server/src/routes/teachers.js` & `server/src/core/services/teachers.js`: `birth_date::text`.
  - `server/src/routes/assignments.js` & `server/src/core/services/assignments.js`: `anchor_date::text`, `end_date::text`.
  - `server/src/routes/groups.js` & `server/src/core/services/groups.js`: `left_on::text`.
  - `server/src/routes/alerts.js` & `server/src/core/services/alerts.js`: `s.session_date::text`.
  - `server/src/routes/cafePurchases.js` & `server/src/lib/cafeReports.js`: `purchased_at::text`.
  - `server/src/routes/accountingPeriods.js`, `server/src/routes/accountingJournal.js`, `server/src/lib/accountingJournal.js`, & `server/src/lib/accountingReports.js`: `start_date::text`, `end_date::text`, `entry_date::text`.
- **`client/src/pages/SchedulePage.jsx`**
  - Added `normalizeEvery(every)` used by both `formatEvery()` and `nextOccurrence()` to convert `{ years: n }` into `{ months: n * 12 }` (since PostgreSQL normalizes `INTERVAL '12 months'` into `{ years: 1 }`) and parse string intervals.

### 2.3 Multi-Session Period Aggregation & Dashboard Filtering
- **`server/src/lib/results.js`**
  - Updated `buildResults()` so a `null` dimension (`qualityValue` or `quantityValue`) on a later evaluation in the same period does not overwrite an earlier non-null dimension score, while a non-null member-specific evaluation still overrides a whole-group evaluation.
- **`server/src/routes/results.js` & `server/src/core/services/results.js`**
  - Updated evaluation query ordering from `ORDER BY e.membership_id NULLS FIRST` to `ORDER BY (e.membership_id IS NOT NULL), s.session_date ASC, s.seq ASC` for deterministic chronological resolution.
- **`client/src/lib/views.js`**
  - Removed the single-session lock (`if (seenSessionId === null) seenSessionId = e.sessionId`) in `periodView()` that was discarding evaluations from all but the first session in a multi-session period, and guarded dimension merges with `!= null`.
- **`client/src/lib/cube.js`**
  - Sorted `inPeriod` evaluations chronologically by `(sessionDate, sessionId)` in `periodCellMap()` and only overwrote dimension values when `v != null`.
- **`server/src/routes/dashboard.js` & `server/src/core/services/dashboard.js`**
  - Updated group filtering on `student_parameter_assignments` to include member-targeted assignments (`a.group_id = ANY($1::uuid[]) OR EXISTS (SELECT 1 FROM student_group_members m WHERE m.id = a.membership_id AND m.group_id = ANY($1::uuid[]))`).
- **`client/src/pages/DashboardPage.jsx`**
  - Fixed `onSave` handler for the Parameter Constellation modal to call `update.mutate({ dashboardConstellation: next })` instead of invoking the React Query mutation object as a function.

### 2.4 Database Migration `030` & Accounting / Cafe Integrity
- **`server/src/db/migrations/030_audit_fixes.sql`** *(New File)*
  - Replaced `acct_entry_lifecycle()` trigger function to:
    1. Reject voiding closing entries (`OLD.source_type = 'closing'`) with `ACCOUNTING_CLOSING_ENTRY_IMMUTABLE`.
    2. Reject voiding posted entries whose `entry_date` falls inside a closed fiscal period with `ACCOUNTING_PERIOD_CLOSED`.
  - Granted `schedule.view` to any existing role that has `scores.view`, `scores.enter`, or `data.export`.
- **`server/src/lib/accountingJournal.js`**
  - Updated `voidEntry()` to check `source_type === 'closing'` and check whether `entry_date` falls in a closed fiscal period before attempting the update.
  - Added `{ allowLargeEntry = false }` option to `createDraftEntry()` and passed `allowLargeEntry: true` from `closeFiscalPeriod()` so closing entries with >100 accounts do not fail validation.
  - Updated `closeFiscalPeriod()` to handle negative net revenue or negative net expense balances (contra accounts / refunds) and verify `if (posted?.error) return posted;`.
  - Updated `generateOpeningEntry()` to join `students s` and filter `AND s.deleted_at IS NULL`.
- **`server/src/routes/accountingPeriods.js`**
  - Added audit logging (`action: 'accounting.opening_balance'`) to `POST /api/accounting/periods/opening` and mapped `ACCOUNTING_PERIOD_CLOSED` to HTTP `409`.
- **`server/src/routes/accountingJournal.js`**
  - Mapped `ACCOUNTING_PERIOD_CLOSED` and `ACCOUNTING_CLOSING_ENTRY_IMMUTABLE` (and `P0001` trigger exceptions mentioning closed periods) to HTTP `409`.
- **`server/src/lib/cafeSale.js`**
  - Checked the return value of `await voidEntry(...)` inside `voidSale()` and returned `{ error, code, status: 409 }` if the accounting void was rejected (causing the enclosing transaction to roll back cleanly).
- **`server/src/routes/cafeSales.js`, `server/src/routes/cafePurchases.js`, `server/src/routes/cafeInventory.js`, & `server/src/routes/cafeBalances.js`**
  - Caught `P0001` closed fiscal period errors from `postMappedEntry` and returned HTTP `409` with `{ code: 'ACCOUNTING_PERIOD_CLOSED' }` instead of an unhandled `500`.
- **`server/src/lib/cafeReports.js`**
  - Joined `students s ON s.id = sb.student_id` with `AND s.deleted_at IS NULL` in `getRangeReport()` so soft-deleted students are excluded from active debtor/prepaid totals.

### 2.5 Permissions, Alerts, Tasks, Audit Log, Agent Route, & Server Scripts
- **`server/src/lib/permissions.js` & `server/test/auth.test.js`**
  - Added `'schedule.view'` to `PREREQUISITES` for `'scores.view'`, `'scores.enter'`, and `'data.export'` so roles that evaluate, view results, or export data can fetch `/api/periods` (`GET /api/periods` requires `schedule.view`). Updated unit tests in `server/test/auth.test.js`.
- **`server/src/lib/alerts.js`**
  - Updated `scanAlerts()` (`missing_scores` query) to exclude sessions that already have non-null evaluations for active parameters (`NOT EXISTS (...)`).
- **`server/src/routes/tasks.js` & `server/src/core/services/tasks.js`**
  - Updated `DELETE /api/tasks/:id` to wrap the deletion in a transaction and execute `UPDATE sessions SET updated_at = NOW() WHERE id = $1`.
- **`server/src/routes/audit.js`, `server/src/core/services/audit.js`, `client/src/lib/audit.js`, `client/src/i18n/fa/admin.json`, & `client/src/i18n/en/admin.json`**
  - Synchronized audit categories (`cafe_product`, `cafe_supplier`, `cafe_purchase`, `cafe_inventory`, `cafe_sale`, `cafe_balance`, `accounting`) across server and client, added prefix matching for multi-entity categories (`cafe_waste.*`, `cafe_adjustment.*`, `accounting_account.*`, `accounting_period.*`, `accounting_mapping.*`, `accounting_entry.*`), and added Persian (`fa`) and English (`en`) translations for every category and action.
- **`server/src/routes/agent.js`**
  - Updated voice-sale linkage in `GET /api/agent/transcripts` from `WHERE s.note = 'voice'` to `WHERE (s.note = 'voice' OR s.note LIKE 'voice:%')`.
- **`server/src/scripts/seedSample.js`**
  - Updated `removeSample()` to delete sample students' cafe sales, stock movements, balance transactions, balances, and accounting journal entries before deleting sample students (avoiding `ON DELETE RESTRICT` errors).
- **`server/src/db/verifyPglite.mjs`**
  - Fixed broken import (`getResetCounts` and `resetApplicationData` from `../lib/resetData.js`) and removed duplicate inline checks.

### 2.6 Client Forms, Views, Navigation, & Orphaned Test Cleanup
- **`client/src/components/StudentFieldsSection.jsx`**
  - Formatted `date` custom fields via `formatIsoDate(value)` in `formatFieldValue` and invalidated `['students']` alongside `['student', studentId]` on save so table views reflect updated custom field values immediately.
- **`client/src/components/StudentForm.jsx`**
  - Rendered `<StudentFieldInputs>` inside the student creation/edit form when `fieldDefs` are provided.
- **`client/src/pages/GroupsPage.jsx`**
  - Keyed `pastMembers` rows by `s.membershipId ?? s.id` (preventing duplicate React keys when a student rejoins and leaves a group multiple times) and formatted `s.leftOn` with `formatIsoDate(s.leftOn)`.
- **`client/src/components/StudentBalanceSection.jsx` & `client/src/pages/CafeSalesPage.jsx`**
  - Added query invalidations for `['cafe-balance-students']`, `['cafe-balance']`, `['cafe-reports']`, `['accounting-entries']`, and `['accounting-reports']` after balance adjustments, sales, and voids.
- **`client/src/components/Layout.jsx`**
  - Computed `flatActiveTo` using longest-prefix matching for the collapsed desktop rail so `/students/import` highlights only `/students/import` and not `/students`.
- **Deleted Orphaned `client/test/` Directory (12 Files)**
  - Deleted `client/test/cells.test.js`, `csv.test.js`, `cube.test.js`, `dashboard.test.js`, `format.test.js`, `importNames.test.js`, `numbers.test.js`, `resultsView.test.js`, `savedView.test.js`, `scoreImport.test.js`, `studentFields.test.js`, and `views.test.js` (superseded by the active Vitest suites in `client/src/**/*.test.{js,jsx}`).

### 2.7 Voice Agent (`agent/`) & Deployment Scripts (`deploy/`)
- **`agent/src/dialogue.js`**
  - Wrapped `confirmScreen()` and `#executeSale()` in `try / catch / finally` blocks so a failed sale resets `this.stageGate = null` and `this.spokenConfirmed = false` instead of wedging the kiosk in `'awaiting_screen'`, and added `this.publishState()` calls on confirm, cancel, and error paths.
- **`agent/src/tools.js`**
  - Guarded `findProduct()` against empty search queries (`if (!q) return null`), cleared `spokenConfirmed` and `stageGate` whenever `add_to_cart`, `remove_from_cart`, or `attach_student` mutates the draft order, and changed `todayIso()` to use `timeZone: 'Asia/Tehran'` (`en-CA`).
- **`agent/src/llm.js`**
  - Added `tool_call_id: call.id` to `role: 'tool'` messages pushed to `this.history`.
- **`deploy/backup.sh`, `deploy/restore.sh`, & `deploy/student-panel-backup.service`**
  - Replaced `. "$ENV_FILE"` shell sourcing with safe `grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=' "$ENV_FILE"` extraction.
  - Added `umask 077` and atomic temporary file creation (`${OUT}.tmp` -> `mv`) in `deploy/backup.sh`.
  - Added `--single-transaction -v ON_ERROR_STOP=1` to `psql` in `deploy/restore.sh`.
  - Added `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, and `ProtectHome=true` to `deploy/student-panel-backup.service`.
- **`CLAUDE.md` & `AGENTS.md`**
  - Updated `Layout.jsx`, `pages/`, and `lib/` test location documentation to match the current architecture.

---

## 3. What Couldn't Be Touched (and Why)

1. **Historical SQL Migration Files (`server/src/db/migrations/001_*.sql` through `029_*.sql`)**
   - **Why**: `server/src/db/migrate.js` is strictly forward-only and tracks applied migration filenames in `schema_migrations`. Editing already-applied migration files (`025_accounting.sql`, `027_scheduling_permissions.sql`, etc.) would not run on existing databases and violates forward-only migration discipline.
   - **Resolution**: All database trigger and role-permission updates were placed in a new forward migration: `server/src/db/migrations/030_audit_fixes.sql`.

2. **`.nav-logout` Selector in `client/src/index.css` (Audit Note §3.5)**
   - **Why**: The earlier audit note mentioned checking for a dead `.nav-logout` rule in `client/src/index.css`. Inspection of `client/src/index.css` confirmed `.nav-logout` had already been removed and replaced by `.account-signout`; no dead CSS rule existed to remove.

3. **Live External PostgreSQL Integration Suite (`npm run test-permissions` / `RUN_INTEGRATION=1`)**
   - **Why**: The container environment runs an in-memory PGlite database rather than an external PostgreSQL server daemon with the pre-seeded integration test accounts expected by `server/test/permissions.test.js`.
   - **Resolution**: All unit tests (`npm --prefix server test`), PGlite-backed core service integration tests (`npm --prefix server run test:core`), and full 30-migration PGlite verification (`npm --prefix server run verify-pglite`) were executed and verified.

4. **AI Studio Preview Bootstrap Files (`live-audit-server.mjs` and root `package.json`)**
   - **Why**: In the AI Studio preview environment, port 3000 is served by the root `npm run dev` script (`node live-audit-server.mjs`), which boots the Express app backed by in-memory PGlite and serves `client/dist`. Removing or altering the preview bootstrap would break the live preview on port 3000.

5. **Pushing to a Remote Git Repository (`git push`)**
   - **Why**: The container workspace (`/app/applet`) was provisioned without a `.git` directory, configured `git` remote URL, SSH keys, or `gh` CLI authentication tokens.
   - **Resolution**: A local Git repository was initialized (`git init`), `.gitignore` rules were enforced (excluding `node_modules/`, `dist/`, `.env*`, and any secrets), and all changes were committed cleanly to the local branch so the working tree is clean and ready to push as soon as a remote URL and credentials are attached.

---

## 4. Verification Summary

All automated test suites, linters, migration checks, and production builds were executed and passed:

| Package / Check | Command | Result |
| :--- | :--- | :--- |
| **Server Unit Tests** | `npm --prefix server test` | **135 passed**, 0 failed (4 integration tests skipped without `RUN_INTEGRATION=1`) |
| **Server Core Service Tests (PGlite)** | `npm --prefix server run test:core` | **54 passed**, 0 failed |
| **Server SQL Migrations & Invariants** | `npm --prefix server run verify-pglite` | **30 migrations applied** (`001`–`030`), all sanity checks **PASS** |
| **Voice Agent Tests** | `npm --prefix agent test` | **21 passed**, 0 failed |
| **Client ESLint** | `npm --prefix client run lint` | **0 warnings, 0 errors** |
| **Client Vitest Suite (incl. i18n Parity)** | `npm --prefix client test -- --run` | **23 test files, 204 tests passed** |
| **Client Production Bundle** | `npm --prefix client run build` | **Built cleanly** to `client/dist` |
| **Live Preview Server Health** | `GET http://localhost:3000/api/health` | `{"ok":true}` |
