# Comprehensive 4-Pass Repository Audit Report (`sp-gemini-main`)

> **Historical pre-remediation evidence.** The harness and credentials named
> below were throwaway audit fixtures and are not shipped. Findings were
> independently reconciled and finally dispositioned in
> [`audit-2026-10-28-sp-gemini-1-opencode.md`](audit-2026-10-28-sp-gemini-1-opencode.md).

Audited across `server/`, `client/`, `agent/`, `scripts/`, and `deploy/` without modifying any repository source files.
An external runtime harness (`/live-audit-server.mjs`) hosted the application
and a richly seeded database on port `3000` with throwaway role-specific users
(passwords redacted), so both the unshimmed failures (`[AUDIT-REPRO]` in server
stdout) and the live shimmed application could be inspected directly.

---

## Verification Baseline

| Suite / Check | Command | Result |
| --- | --- | --- |
| Server unit tests | `npm --prefix server test` | **217 / 217 passing** (`test/permissions.test.js` skipped without `RUN_INTEGRATION=1`) |
| Server PGlite core service tests | `npm --prefix server run test:core` | **54 / 54 passing** (`src/core/**/*.test.js`) |
| Server PGlite migrations & invariants | `npm --prefix server run verify-pglite` | **30 migrations (`001`–`030`) & all invariants passing** |
| Client unit & component tests (Vitest) | `npm --prefix client test` | **23 test files / 204 tests passing** (including `fa`/`en` i18n key-tree parity) |
| Legacy orphaned `client/test/*.test.js` | `node --test client/test/*.test.js` | **4 / 12 files failing** (orphaned pre-Vitest / pre-029 `node:test` files; see Problem #17) |
| Client ESLint | `npm --prefix client run lint` | **0 errors / 0 warnings** |
| Client production bundle | `npm --prefix client run build` | **Clean build to `client/dist`** (1,017 modules) |
| Voice Agent test suite | `npm --prefix agent test` | **21 / 21 passing** |

---

## Pass-by-Pass Summary

1. **Pass 1 — Big Picture (Architecture, Structure, Dependencies, Config, Security, Data Model):**
   - Clean 3-package modular architecture (`server/`, `client/`, `agent/`) + `deploy/` systemd/backup scripts.
   - Strong security fundamentals: Argon2id password hashing + dummy-hash timing equalization on login miss (`server/src/routes/auth.js:55-68`), session regeneration on login (`auth.js:116`), double-submit CSRF cookie + constant-time verification (`server/src/middleware/csrf.js:47-62`) + Origin/Referer host check in production, strict Helmet CSP (`server/src/index.js:64-78`), parameterized SQL (`$n`) with server-side column/sort whitelists, fail-closed `authorize(policy)` middleware (`server/src/middleware/auth.js:62-97`), and database-enforced accounting/cafe ledger triggers (`023`, `024`, `025`).
   - Key structural/data-model gaps found: no custom PostgreSQL OID `1082` (`date`) parser in `server/src/db/pool.js` or `server/src/db/pglite.js` while ~50% of routes select `date` columns without `::text`; duplicated and drifting logic between `server/src/routes/*` and `server/src/core/services/*` (the Capacitor/PGlite local backend is missing post-018 modules and post-013 audit categories); `resetData.js` truncates `acct_fiscal_periods`, `acct_mappings`, and `acct_accounts`, and migrations `025`/`026` do not seed an initial open fiscal period.
2. **Pass 2 — Backend (Logic Bugs, Error Handling, Edge Cases, Performance):**
   - Confirmed server-side chronological sorting bug in `assignPeriods()` when `session_date` is a `Date` object; multi-session period cell overwrites and missing `ORDER BY` in `GET /api/results`; unhandled PostgreSQL `P0001` (`cannot post into a closed fiscal period`) exceptions returning `500` in Cafe auto-posting and Opening Entry creation; soft-deleted student balances leaking into Cafe debtor reports and Accounting opening entries; audit category filter prefix mismatches; and multiple state/protocol bugs in the Voice Agent (`agent/src/dialogue.js`, `agent/src/tools.js`, `agent/src/llm.js`).
3. **Pass 3 — Frontend (Bugs, Layout/Styling Issues, Accessibility):**
   - Confirmed `TypeError: update is not a function` crash on `DashboardPage.jsx` when changing any constellation option; multi-session period loss and group-score overwrite bugs in `client/src/lib/views.js` (`periodView`) and `client/src/lib/cube.js` (`buildCube`); Synthetic Whole-Group row inflating denominator and mean/min/max in `ResultsPage` (`client/src/lib/resultsView.js`); raw ISO date strings on custom `date` fields (`StudentFieldsSection.jsx`); raw unlocalized audit action keys for Cafe and Accounting (`AuditPage.jsx`); and multiple CSS/RTL/mobile layout issues (`h1 + .hint` `-8px` negative-margin title overlap inside `.page-head`, `.group-filter` mobile horizontal overflow at `390px` viewport, `.segmented` stretching full-width inside `.pref-group`, 0px label-to-select gaps in toolbars, `.eval-input` 56px placeholder clipping, `StudentForm` submit button placed above custom fields, and `initialsOf` rendering `م(` for names with parentheses).
4. **Pass 4 — Live Runtime, Console/Network Logs & Visual Inspection:**
   - Verified both unshimmed runtime failures (`[AUDIT-REPRO]` in server logs) and live browser rendering across desktop (`1440×900`) and mobile (`390×844`) viewports via Playwright, inspecting console warnings (`THREE.Clock` deprecation warning from `@react-three/fiber` / `three@0.183.2`), page errors (`TypeError: update is not a function`), network responses, and full-page screenshots.

---

## Problems (Ordered by Severity: Critical → Major → Minor → Cosmetic)

### Critical

#### 1. [Critical] Uncast PostgreSQL `date` columns (OID `1082`) deserialize as JS `Date` instances, crashing 11+ client pages (`RangeError: Invalid time value` / `RangeError: Invalid Jalaali year -100721`), mis-ordering `assignPeriods()` on the server, and breaking partial fiscal-period validation

- **Where:**
  - `server/src/db/pool.js:10-16` & `server/src/db/pglite.js:52-66` (no OID `1082` type parser override)
  - `client/src/lib/locale.js:35-38, 54, 74, 79, 86` (`localDateFromIso`, `formatLocaleDate`, `jalaliPartsFromIso`)
  - `server/src/routes/sessions.js:21-23, 56` (`s.planned_date AS "plannedDate"`, `s.moved_to AS "movedTo"`, `s.session_date AS "sessionDate"`) + `server/src/lib/periods.js:48` (`String(a.sessionDate).localeCompare(String(b.sessionDate))`)
  - `server/src/routes/students.js:61` (`birth_date AS "birthDate"` in `STUDENT_SELECT`)
  - `server/src/routes/alerts.js:20` (`s.session_date AS "sessionDate"`)
  - `server/src/routes/accountingPeriods.js:18-19, 89, 105, 122-126` (`start_date`, `end_date`, `entry_date`)
  - `server/src/lib/accountingJournal.js:23` (`e.entry_date AS "entryDate"`)
  - `server/src/lib/accountingReports.js:187` (`e.entry_date AS "entryDate"` in `getGeneralLedger`)
  - `server/src/routes/cafePurchases.js:60` (`p.purchased_at AS "purchasedAt"`)
  - `server/src/lib/cafeReports.js:7` (`sold_at::date AS day`)
  - `server/src/routes/teachers.js:14` (`birth_date AS "birthDate"`)
  - `server/src/routes/assignments.js:17` (`a.anchor_date AS "anchorDate"`)
  - `server/src/routes/groups.js:419-420` (`m.added_at::date AS "joinedOn"`, `m.left_on AS "leftOn"`)
- **Confirmed by:** Running (reproduced in `[AUDIT-REPRO]` on PGlite and verified across client formatters) + reading code.
- **Details & Reproduction:**
  1. Both `pg` and `@electric-sql/pglite` deserialize PostgreSQL `date` columns (OID `1082`) into JavaScript `Date` instances unless cast with `::text` in SQL or overridden via `setTypeParser(1082, (v) => v)`. While `periods.js:26-27`, `evaluations.js:58`, `dashboard.js:35`, and `exportCube.js:81, 104, 152` explicitly cast `::text`, the 11 route/lib files listed above do **not**.
  2. **Client-side `ErrorBoundary` crashes and broken date rendering across 11+ pages:** When Express serializes a `Date` instance to JSON, it emits an ISO timestamp string (`"2026-09-26T00:00:00.000Z"`). On the client, `localDateFromIso(isoDate)` (`client/src/lib/locale.js:35-38`) runs:
     ```js
     const [y, m, d] = isoDate.split('-').map(Number);
     ```
     With `"2026-09-26T00:00:00.000Z"`, `d` evaluates to `Number("26T00:00:00.000Z")` -> `NaN`, producing an `Invalid Date`.
     - Calling `formatLocaleDate` / `bothDates` (`locale.js:54, 74, 79`) calls `Intl.DateTimeFormat.prototype.format(Invalid Date)`, throwing **`RangeError: Invalid time value`**.
     - Calling `jalaliTextFromIso` (`locale.js:86`, used by `JalaliDatePicker`) passes `NaN` to `toJalaali(y, m, d)`, throwing **`RangeError: Invalid Jalaali year -100721`**.
     - Calling `formatIsoDate(isoDate)` (`format.js:76-81`) checks `/^\d{4}-\d{2}-\d{2}$/.test(isoDate)`, which fails on `"2026-09-26T00:00:00.000Z"` and falls back to returning the raw unformatted UTC timestamp string in the UI.
     - Affected pages/views when data exists: `SessionsPage.jsx:674` (plus `AlertsSection` via `alerts.js:20`), `StudentDetailPage.jsx` (`StudentIdentitySection.jsx:39, 97` whenever a student has `birthDate`), `EvaluatePage.jsx:412`, `ImportScoresPage.jsx:580`, `AccountingPeriodsPage.jsx:56, 249`, `AccountingJournalPage.jsx:352`, `AccountingReportsPage.jsx:302` (General Ledger tab), `CafePurchasesPage.jsx:399`, `CafeReportsPage.jsx:157`, `TeachersPage.jsx:71, 230` (when `birthDate` is set), `SchedulePage.jsx:38, 635`, and `GroupsPage.jsx:109-110` (`MemberPanel` whenever a group has active/past members).
  3. **Server-side chronological mis-ordering of sessions and periods (`server/src/routes/sessions.js:56` -> `server/src/lib/periods.js:48`):**
     `withPeriodSeqs()` in `server/src/routes/sessions.js:51-56` queries `SELECT id, seq, session_date AS "sessionDate" FROM sessions` (where `sessionDate` is a `Date` object) and passes those rows to `assignPeriods(list)` (`server/src/lib/periods.js:44-50`):
     ```js
     const ordered = [...sessions].sort((a, b) => {
       const byDate = String(a.sessionDate).localeCompare(String(b.sessionDate));
       if (byDate !== 0) return byDate;
       return a.seq - b.seq;
     });
     ```
     Because `a.sessionDate` is a `Date` instance, `String(a.sessionDate)` is `"Fri Apr 10 2026 00:00:00 GMT+0000..."` or `"Mon Apr 06 2026..."`. `localeCompare` therefore sorts sessions **alphabetically by English weekday abbreviation** (`"Fri..."` < `"Mon..."` < `"Sat..."` < `"Sun..."` < `"Thu..."` < `"Tue..."` < `"Wed..."`) instead of chronologically! Confirmed in `[AUDIT-REPRO]`: a 5th chronological session held on Friday (`2026-04-10`, `seq: 5`) sorts *first* ahead of Monday–Thursday (`2026-04-06`..`2026-04-09`) and is wrongly assigned to `periodSeq: 1` instead of `periodSeq: 2`.
  4. **Server-side validation bypass on `PATCH /api/accounting/periods/:id` (`server/src/routes/accountingPeriods.js:105, 122-126`):**
     `current.rows[0]` contains `startDate` and `endDate` as `Date` instances. If a `PATCH` payload supplies only `startDate` or only `endDate` (a `'YYYY-MM-DD'` string), `if (next.startDate > next.endDate)` compares a `Date` object with a `'YYYY-MM-DD'` string (`Number("2026-03-21")` is `NaN`), so `next.startDate > next.endDate` evaluates to `false` even when `startDate > endDate`, bypassing the `400 VALIDATION_INVALID_DATE_RANGE` response and crashing with a `500` PostgreSQL `CHECK (end_date >= start_date)` constraint error.

---

#### 2. [Critical] `DashboardPage.jsx` calls `usePreferences().update(...)` as a function, but `update` is a TanStack Query `UseMutationResult` object — throwing `TypeError: update is not a function` whenever any Dashboard constellation control is changed

- **Where:**
  - `client/src/pages/DashboardPage.jsx:40, 107-109, 178, 192, 213, 227`
  - `client/src/preferences/PreferencesProvider.jsx:54, 81`
  - Compare with `client/src/pages/PreferencesPage.jsx:104` (`update.mutate(changes)`)
- **Confirmed by:** Running in headless Chromium via Playwright (`PAGEERROR: TypeError: r is not a function` at `DashboardPage`) + reading code.
- **Details & Reproduction:**
  1. In `client/src/preferences/PreferencesProvider.jsx:54, 81`, `const update = useMutation({ mutationFn: updatePreferences, ... })` is exposed directly in the context value `{ preferences, isLoading, update }`.
  2. `PreferencesPage.jsx:104` correctly calls `update.mutate(changes)`.
  3. However, `DashboardPage.jsx:40, 107-109` destructures `{ preferences, update } = usePreferences()` and defines:
     ```js
     function persist(changes) {
       update({ dashboardConstellation: { ...options, ...changes } });
     }
     ```
  4. **Steps to reproduce:** Log in, open `/dashboard`, click **میدان دید / Field of view** (`<details class="panel"><summary>`), and change the Assignment dropdown, Period dropdown, Quality/Quantity radio toggle, or Score/Score-or-note radio toggle. React immediately throws `TypeError: update is not a function` and unmounts the entire application into `ErrorBoundary`.

---

### Major

#### 3. [Major] Multi-session period overwrite, missing `ORDER BY`, and missing group-score shadowing across `GET /api/results` (`server/src/lib/results.js`), Student Detail `ByPeriodView` (`client/src/lib/views.js`), and Export Cube (`client/src/lib/cube.js`)

- **Where:**
  - `server/src/routes/results.js:76-82, 122-133` & `server/src/core/services/results.js:113-123`
  - `server/src/lib/results.js:23-39, 52-97` (`indexCells`, `buildResults`)
  - `client/src/lib/resultsView.js:112-129` (`parameterSummary`)
  - `client/src/lib/views.js:23-61` (`periodView` used by `client/src/components/ByPeriodView.jsx:39`)
  - `client/src/lib/cube.js:69-84` (`buildCube` used by `client/src/pages/ExportPage.jsx`)
- **Confirmed by:** Running (reproduced in `[AUDIT-REPRO]` and verified visually in `06-results.png` and `08-student-by-period.png`) + reading code.
- **Details:**
  Under migration `029_periods_and_evaluations_by_session.sql`, each assignment period groups up to **4 sessions** (`SESSIONS_PER_PERIOD = 4`, `periodIdsFor(sessions, seq)`). However, the period-level result aggregators were only partially updated from the pre-029 one-evaluation-per-period model:
  1. **`GET /api/results` (`server/src/routes/results.js:122-133` + `server/src/lib/results.js:23-39`):**
     - The SQL query `WHERE e.session_id = ANY($1::uuid[]) AND e.archived_at IS NULL` has **no `ORDER BY` clause**.
     - `indexCells(evaluations, dimension)` (`server/src/lib/results.js:23-39`) iterates over those rows and does `map.set(key, { value, comment })` keyed only by `${item.membershipId ?? 'group'}:${item.parameterId}`.
     - Consequently:
       - **(a) Non-deterministic session winner:** When a student is scored in multiple sessions of the same 4-session period, whichever row PostgreSQL returns last in its heap/index scan overwrites the others.
       - **(b) Unanswered expectation (`value: null`) wipes earlier real scores:** If a teacher selects a cell as an unanswered expectation (`quality_value IS NULL`) in Session 2 after recording `88` in Session 1 of the same period, Session 2's `null` overwrites Session 1's `88` so the student appears unmeasured (`value: null`) for the entire period (confirmed in `[AUDIT-REPRO]`).
       - **(c) Whole-group scores never shadow onto members in `buildResults`:** Unlike `dashboard.js:73-93`, `export.js:129-144`, `history.js:55-68`, and `views.js:34-57` — all of which apply whole-group evaluations (`membership_id IS NULL`) as defaults for group members who lack an individual row — `buildResults()` never falls back to `group:${parameter.id}` for member rows.
       - **(d) Synthetic whole-group row (`id: null`, `isGroupRow: true`) distorts `ResultsPage` summary statistics (`client/src/lib/resultsView.js:112-129`):** `server/src/routes/results.js:76-82` appends a synthetic row `{ id: null, isGroupRow: true }` to `targets`. On the client, `parameterSummary(rows, parameter.id)` (`resultsView.js:112-129`) iterates over **all** `rows` (including `isGroupRow: true`), inflating `total: rows.length` by `+1` (confirmed visually in `06-results.png`: `ثبت‌شده: 4 از 5` for a 4-student group!) and double-counting the group row alongside member rows in `mean`, `min`, and `max`. Notice that `client/src/lib/dashboard.js:25` explicitly filters `results.rows.filter((row) => !row.isGroupRow)`, whereas `resultsView.js` does not!
  2. **Student Detail `ByPeriodView` (`client/src/lib/views.js:23-61`):**
     - `evaluations` are sorted ascending (`ORDER BY s.session_date, s.seq`).
     - Inside `periodView()`, lines `45-47` do:
       ```js
       const existing = cellValue.get(key);
       if (!existing || existing.viaGroup) {
         cellValue.set(key, { value: pickValue(evaluation, dimension), viaGroup: isViaGroup });
       }
       ```
     - Because `!existing` is false after the **first** member evaluation in a period, sessions 2, 3, and 4 in the same period are **completely ignored**! Even worse, if Session 1 had a selected-but-unanswered row (`value: null, viaGroup: false`) and Session 2 had a score of `95`, `periodView` locks onto Session 1's `null` and hides Session 2's `95` (confirmed in `[AUDIT-REPRO]`).
     - Conversely, if Session 1 had a whole-group score (`value: 80, viaGroup: true`) and Session 2 had an unanswered member expectation (`value: null, viaGroup: false`), `existing.viaGroup` is `true`, so the `null` member row overwrites the `80` group score with `null`.
     - Finally, `bucketOf(sessionDate)` (`views.js:25-32`) matches sessions to periods by date range (`period.startDate <= sessionDate && sessionDate <= period.endDate`) instead of session membership; if Session 4 of Period 1 and Session 1 of Period 2 occur on the same date (or a moved session crosses another period's date range), `find()` buckets both into Period 1.
  3. **Export Cube (`client/src/lib/cube.js:69-84`):**
     - Uses `evaluation.sessionDate.localeCompare(existing.sessionDate) > 0` (`>= 0` on group-to-member upgrade), so: (a) if two sessions in the same period share a `sessionDate`, `localeCompare` is `0` and the later `seq` is ignored; and (b) a later selected-but-unanswered row (`value: null`) in the same period overwrites an earlier answered score.

---

#### 4. [Major] Permission prerequisite gap in `server/src/lib/permissions.js` causes `403 Forbidden` on `EvaluatePage`, `ImportScoresPage`, `ResultsPage`, and `ExportPage` for roles with `scores.enter`, `scores.view`, or `data.export` that lack `schedule.view`

- **Where:**
  - `server/src/lib/permissions.js:34-46, 110, 114` (`PERMISSIONS`, `PREREQUISITES`)
  - `server/src/index.js:273, 283` (`/api/assignments` and `/api/sessions` require `schedule.view`)
  - `client/src/pages/EvaluatePage.jsx:58, 69` (fetches `listAssignments()` and `listSessions()`)
  - `client/src/pages/ImportScoresPage.jsx:192, 205` (fetches `listAssignments()` and `listSessions()`)
  - `client/src/pages/ResultsPage.jsx:50` (fetches `listAssignments()`)
  - `client/src/components/export/ExportScopePicker.jsx` (fetches `listAssignments()` and `listSessions()`)
- **Confirmed by:** Reading code.
- **Details:**
  - Under the post-029 session/assignment architecture, entering scores (`/evaluate`, `/evaluate/import`), viewing results (`/results`), and exporting data (`/export`) all depend on loading the assignment and session pickers from `GET /api/assignments` and `GET /api/sessions`.
  - Both `GET /api/assignments` and `GET /api/sessions` are gated by `authorize({ GET: 'schedule.view' })` (`server/src/index.js:273, 283`).
  - However, in `server/src/lib/permissions.js:108-123`:
    - `PREREQUISITES['scores.enter']` is `['students.view', 'parameters.view']` (missing `'schedule.view'`),
    - `scores.view` has **no** entry in `PREREQUISITES` at all (missing `'schedule.view'`, `'students.view'`, and `'parameters.view'`),
    - `PREREQUISITES['data.export']` is `['students.view']` (missing `'schedule.view'` and `'scores.view'`, even though `server/src/routes/export.js:20` enforces `requirePermission('scores.view')` in-route!).
  - While migration `020_grant_schedule_to_seeded_roles.sql` manually inserted `schedule.view` into the three original seeded roles (`Administrator`, `Evaluator`, `Viewer`), any custom role created via `/roles` (such as a "Blind Entry" role with `scores.enter`, a "Scorer" role, or an "Auditor/Exporter" role) will not have `schedule.view` auto-expanded by `withPrerequisites()` and will fail with `403 Forbidden` as soon as the user opens `/evaluate`, `/evaluate/import`, `/results`, or `/export`.

---

#### 5. [Major] Voiding a posted journal entry (`voidEntry`, `voidSale`, and trigger `acct_entry_lifecycle`) is NOT blocked when the entry belongs to a CLOSED fiscal period — and even the period's own `closing` entry can be voided

- **Where:**
  - `server/src/db/migrations/025_create_accounting_core.sql:165-204` (`acct_entry_lifecycle` trigger)
  - `server/src/lib/accountingJournal.js:152-171` (`voidEntry`)
  - `server/src/lib/cafeSale.js:184-187` (`voidSale`)
- **Confirmed by:** Reading SQL migration & engine code.
- **Details:**
  - In `025_create_accounting_core.sql:172-186`, the `OLD.status = 'draft' AND NEW.status = 'posted'` branch checks `acct_assert_open_period(NEW.entry_date)`, preventing new postings into a closed fiscal period.
  - However, the `OLD.status = 'posted' AND NEW.status = 'voided'` branch (`lines 188-200`) and `voidEntry()` (`server/src/lib/accountingJournal.js:152-171`) **never call `acct_assert_open_period(OLD.entry_date)`** and **never guard `OLD.source_type = 'closing'`**.
  - As a result:
    1. Any user with `accounting.post` (or `cafe.sell` voiding a historical cafe sale via `POST /api/cafe/sales/:id/void`) can void a posted entry dated inside a **closed** fiscal period, retroactively altering closed-period Trial Balance, Income Statement, and Balance Sheet numbers while Retained Earnings (`3100`) still reflects the un-voided amount.
    2. A user with `accounting.post` (who lacks `accounting.close`) can even call `POST /api/accounting/journal/:id/void` on the period's own `source_type = 'closing'` entry, un-zeroing all revenue and expense accounts of a closed fiscal period while `acct_fiscal_periods.status` remains `'closed'`.

---

#### 6. [Major] `closeFiscalPeriod()` ignores `{ error }` returned by `createPostedEntry()`, silently skipping the closing journal entry while marking the fiscal period `'closed'` when an income/expense account has a contra balance or >50 accounts exist

- **Where:**
  - `server/src/lib/accountingJournal.js:333-348, 376-449` (`createPostedEntry`, `closeFiscalPeriod`)
- **Confirmed by:** Reading code.
- **Details:**
  - In `closeFiscalPeriod()` (`server/src/lib/accountingJournal.js:391-428`), the query selects all `income` and `expense` accounts with `HAVING COALESCE(SUM(...), 0) <> 0`.
  - Lines `415-421` build `closingLines`:
    ```js
    if (row.type === 'income') {
      closingLines.push({ accountId: row.id, debit: balance, credit: 0 });
      netIncome += balance;
    } else {
      closingLines.push({ accountId: row.id, debit: 0, credit: balance });
      netIncome -= balance;
    }
    ```
  - If any `income` account has a negative net balance (`balance < 0`, e.g. from adjustments/reversals) or any `expense` account has a negative net balance (`balance < 0`), `debit: balance` or `credit: balance` is **negative**.
  - `createPostedEntry()` calls `normalizeLines(lines)` (`line 335`), which rejects any negative line amount with `{ error: '...', code: 'VALIDATION_INVALID_RANGE' }` (and also rejects `> 100` lines with `{ code: 'VALIDATION_TOO_LONG' }` if more than 50 income/expense accounts are active).
  - Crucially, at lines `428-438`, `closeFiscalPeriod()` calls `await createPostedEntry(client, ...)` **without checking whether the return value contains `.error`**, and immediately executes `UPDATE acct_fiscal_periods SET status = 'closed', closed_at = now(), closed_by = $2 WHERE id = $1`! The fiscal period is permanently closed with **no** closing journal entry posted to Retained Earnings (`3100`).

---

#### 7. [Major] Closed fiscal period trigger exceptions (`P0001: cannot post into a closed fiscal period`) return unhandled HTTP `500` during Cafe auto-posting and Opening Entry creation

- **Where:**
  - `server/src/lib/accountingJournal.js:219-223, 346-350` (`postMappedEvent`, `generateOpeningEntry`)
  - `server/src/routes/cafeSales.js:32-49`
  - `server/src/routes/cafePurchases.js:201-218`
  - `server/src/routes/cafeBalances.js:88-107`
  - `server/src/routes/cafeInventory.js:161-198`
  - `server/src/routes/accountingPeriods.js:184-216` (`POST /api/accounting/periods/opening`)
- **Confirmed by:** Running (reproduced in `[AUDIT-REPRO]`: `err.code = "P0001"`, `cannot post into a closed fiscal period (1404)`) + reading code.
- **Details:**
  - Migration `025_create_accounting_core.sql:101-106` defines trigger `acct_entry_lifecycle`, which raises `P0001: cannot post into a closed fiscal period (%)` whenever an entry is inserted or updated with `status = 'posted'` and `entry_date` inside a closed fiscal period.
  - Only `POST /api/accounting/journal/:id/post` (`server/src/routes/accountingJournal.js:210-215`) catches `/closed fiscal period/` and returns `409 ACCOUNTING_PERIOD_CLOSED`.
  - `POST /api/accounting/periods/opening` and all four Cafe routes (`cafeSales`, `cafePurchases`, `cafeBalances`, `cafeInventory`, which auto-post via `postMappedEvent` with `status = 'posted'`) do not catch this trigger error, returning an unhandled `500 Internal Server Error` to the client.

---

#### 8. [Major] `GET /api/dashboard/trends` and `GET /api/dashboard/summary` (`server/src/routes/dashboard.js`) mis-weight whole-group evaluations and drop individual-student assignments when filtering by group

- **Where:**
  - `server/src/routes/dashboard.js:37, 50-65, 101`
  - `server/src/core/services/dashboard.js:35, 48-63, 99`
- **Confirmed by:** Reading code.
- **Details:**
  1. **Whole-group evaluations in `GET /api/dashboard/trends` (`dashboard.js:50-65`):**
     - Whereas `GET /api/dashboard/summary` (`lines 73-93`) expands whole-group evaluations (`e.membership_id IS NULL`) across group members and shadows them when a member has an individual evaluation, `GET /api/dashboard/trends` simply runs `avg(e.quality_value)` and `avg(e.quantity_value)` directly over raw `evaluations` rows (`WHERE e.archived_at IS NULL`).
     - Consequently: (a) a single whole-group score (`e.membership_id IS NULL`) for a 20-student group is weighted as `1` row instead of `20` students when combined with individual scores; and (b) if a student in that group also has an individual override row, **both** the whole-group row and the override row are included in `avg()` and `count(*)`.
  2. **Group filter drops individual-student assignments (`dashboard.js:37, 101`):**
     - When `groupId` is selected on the Dashboard, both `/trends` (`line 37`) and `/summary` (`line 101`) filter assignments by `AND a.group_id = ANY($n::uuid[])`.
     - For individual student assignments (`a.group_id IS NULL AND a.membership_id IS NOT NULL`, where the membership belongs to a group in `groupIds`), `a.group_id` is `NULL`, so all individual assignments for students in the selected group are silently excluded from Dashboard trends and summary cards.

---

#### 9. [Major] Voice Agent (`agent/src/*`) state-sync, unhandled rejection crash, confirmation-protocol bypass, OpenAI `tool_call_id` omission, empty-needle match, UTC-vs-Tehran date, and `/api/agent/status` `voiceSales` mismatch bugs

- **Where:**
  - `agent/src/dialogue.js:169-178, 240-273` (`confirmScreen`, `cancelScreen`, `#executeSale`)
  - `agent/src/kiosk.js:63-72` (`onConfirm`, `onCancel`)
  - `agent/src/tools.js:124-127, 145-184, 202, 223-227` (`findProduct`, `add_to_cart`, `remove_from_cart`, `attach_student`, `record_sale`, `sales_report`)
  - `server/src/routes/agent.js:33-38` (`GET /api/agent/status` `voiceSales` query)
  - `agent/src/llm.js:133-141` (`#chatOpenAi`)
- **Confirmed by:** Reading code.
- **Details:**
  1. **`GET /api/agent/status` never counts standard voice sales (`agent/src/tools.js:202` vs `server/src/routes/agent.js:37`):**
     - In `agent/src/tools.js:202`, `record_sale` sends `note: note ? \`voice: ${note}\` : 'voice'`. When `#executeSale()` (`agent/src/dialogue.js:265`) executes a confirmed sale, it calls `this.handlers.record_sale({})` with no `note`, so the audit log stores `details->>'note' = 'voice'` (no colon).
     - However, `server/src/routes/agent.js:37` queries `WHERE action = 'cafe_sale.create' AND details->>'note' LIKE 'voice:%'` (requiring a colon). As a result, normal voice sales are never counted in `voiceSales`, and Step 4 (`sale`) on `/agent` (`AgentPage.jsx:42`) stays stuck in `todo`.
  2. **`cancelScreen()` never updates the kiosk UI (`agent/src/dialogue.js:256-260`):**
     ```js
     cancelScreen() {
       this.state.resetCart();
       this.#clearTimers();
       return { ok: true };
     }
     ```
     Unlike `handleTranscript()` and `confirmScreen()`, `cancelScreen()` never calls `this.publishState()`. When a user taps the Cancel button on the kiosk touch screen, the server resets its internal cart, but the browser screen remains stuck in `awaiting_confirm` displaying the old cart items and active Confirm button.
  3. **Unhandled rejection in `confirmScreen()` / `#executeSale()` can crash the kiosk process or wedge `stageGate = 'open'` (`agent/src/dialogue.js:240-273`, `agent/src/kiosk.js:63-66`):**
     - `handleTranscript()` wraps `#runTurn` in `try / catch` (`dialogue.js:97-111`), but `confirmScreen()` has no `try / catch`, and `kiosk.js:64` calls `onConfirm: async () => dialogue.confirmScreen()` inside an unawaited WebSocket `message` listener.
     - In `#executeSale()` (`dialogue.js:262-273`), `this.state.stageGate = 'open'` is set on line 264 and `this.state.stageGate = 'closed'` on line 266 without `try / finally`. If `this.handlers.record_sale()` throws (e.g., `INSUFFICIENT_STOCK` 409 from `panel.recordSale` or a transient network error), `stageGate` stays `'open'` permanently and the unhandled rejection crashes the Node process. Also, if `record_sale` returns `{ ok: false }`, `#executeSale` returns early on line 267 without calling `this.publishState()`.
  4. **LLM tool calls bypass the cart-mutation confirmation reset (`agent/src/tools.js:145-184` vs `agent/src/dialogue.js:8, 171-178`):**
     - The architecture invariant (`dialogue.js:8`) states: *"Any cart change after that resets confirmation."*
     - In the rule-based path (`#runIntent`, `dialogue.js:171-178`), `add_to_cart`, `remove_from_cart`, and `attach_student` explicitly reset `this.state.phase = 'idle'; this.state.spokenConfirmed = false;`.
     - However, when an LLM brain (`ollama` or `openai`) handles a turn (`#runWithLlm`, `dialogue.js:128-140`), it invokes `this.handlers[call.name](call.arguments)` directly in `tools.js:145-184`, which mutates `state.cart` and `state.student` **without** resetting `state.phase` or `state.spokenConfirmed`.
  5. **OpenAI tool-call response omits required `tool_call_id` (`agent/src/llm.js:138-141`):**
     In `#chatOpenAi()`, each tool result is appended as `{ role: 'tool', content: JSON.stringify(result) }` without `tool_call_id: call.id`, which OpenAI's `/v1/chat/completions` API rejects with `400 Bad Request`.
  6. **`findProduct()` matches the first product when `productName` normalizes to `""` (`agent/src/tools.js:124-127`):**
     `findProduct(state, name)` computes `const needle = normalizeForMatch(name)` and immediately checks `normalizeForMatch(p.name).includes(needle)` without `if (!needle) return undefined;` (unlike `findStudent` right below it at line 132). Since `"".includes("")` is `true`, an empty or punctuation-only `productName` matches `state.products[0]`.
  7. **`sales_report` tool uses UTC date instead of `Asia/Tehran` (`agent/src/tools.js:223-227`):**
     `const today = new Date().toISOString().slice(0, 10);` uses UTC date instead of `Asia/Tehran`.

---

#### 10. [Major] Audit log category filter mismatches emitted action prefixes for Cafe Inventory (`cafe_waste`, `cafe_adjustment`) and Accounting (`accounting_account`, `accounting_mapping`, `accounting_entry`), and `core/services/audit.js` is missing 15+ categories

- **Where:**
  - `server/src/routes/audit.js:6-36, 60-61`
  - `server/src/routes/cafeInventory.js:181`
  - `server/src/routes/accountingJournal.js:138, 204, 244`
  - `server/src/routes/accountingAccounts.js:84, 151, 211`
  - `server/src/core/services/audit.js:16-33`
  - `client/src/lib/audit.js:3-32`
- **Confirmed by:** Running + reading code.
- **Details:**
  - `GET /api/audit` filters by category using `split_part(a.action, '.', 1) = $n` (`server/src/routes/audit.js:61`).
  - `client/src/lib/audit.js:24` exposes category `'cafe_inventory'`, which `server/src/routes/audit.js:27` allows, but `server/src/routes/cafeInventory.js:181` records actions as `'cafe_waste.create'` and `'cafe_adjustment.create'`. Filtering by **انبار کافه / Cafe inventory** queries `split_part(a.action, '.', 1) = 'cafe_inventory'`, which always returns **0 rows**.
  - Similarly, `client/src/lib/audit.js:25` exposes `'accounting'`, which only matches `'accounting.opening_balance'` and misses `'accounting_account.*'`, `'accounting_mapping.update'`, and `'accounting_entry.*'` (`create`, `post`, `void`).
  - Furthermore, `server/src/core/services/audit.js:16-33` only allows 9 early categories (`scores`, `student`, `parameter`, `parameter_change`, `settings`, `user`, `role`, `auth`, `api`), rejecting any filter on `group`, `field`, `teacher`, `interval`, `assignment`, `session`, `task`, `task_template`, `alert`, `cafe_*`, `accounting*`, or `agent` with `400 VALIDATION_INVALID_CHOICE`.

---

#### 11. [Major] Soft-deleted students' balances are still counted in Cafe Reports debt totals and the Accounting Opening Entry snapshot

- **Where:**
  - `server/src/lib/cafeReports.js:68-73` (`getRangeReport`)
  - `server/src/lib/accountingJournal.js:256-261` (`generateOpeningEntry`)
- **Confirmed by:** Running (reproduced in `[AUDIT-REPRO]`: `debtorCount = 2, outstandingDebt = -205000` includes soft-deleted student `ST99999Z` with `-85,000` Toman balance) + reading code.
- **Details:**
  - When a student is soft-deleted (`DELETE /api/students/:id` sets `deleted_at = now()`), `GET /api/cafe/balances/students` (`server/src/routes/cafeBalances.js:37`) excludes them via `WHERE s.deleted_at IS NULL`.
  - However, `getRangeReport()` (`server/src/lib/cafeReports.js:68-73`) queries `FROM student_balances WHERE balance < 0` without joining `students` to check `s.deleted_at IS NULL`.
  - Likewise, `generateOpeningEntry()` (`server/src/lib/accountingJournal.js:256-261`) sums `student_balances` for accounts `2100` (Student Prepayments) and `1110` without excluding soft-deleted students.

---

#### 12. [Major] `resetData.js` truncates `acct_accounts`, `acct_mappings`, and `acct_fiscal_periods`, and migrations `025`/`026` never seed an initial open fiscal period

- **Where:**
  - `server/src/scripts/resetData.js:22-35, 72-116`
  - `server/src/db/migrations/025_create_accounting_core.sql` & `026_create_accounting_chart.sql`
- **Confirmed by:** Running migrations `001`–`030` in PGlite + reading code.
- **Details:**
  - Neither migration `025` nor `026` seeds a row into `acct_fiscal_periods` (confirmed in `025_create_accounting_core.sql` and `026_create_accounting_chart.sql`: `acct_fiscal_periods` starts with 0 rows).
  - Furthermore, in `server/src/scripts/resetData.js:22-35`, `TABLES_TO_WIPE` includes `acct_fiscal_periods`, `acct_mappings`, and `acct_accounts`! While `resetData.js` has comments on lines 7-8 claiming *"The chart of accounts (`acct_accounts`), the default cafe→journal mappings (`acct_mappings`), and the seeded roles ... are kept"*, lines `33-34` actually include `'acct_mappings'` and `'acct_accounts'` in `TABLES_TO_WIPE` and line `92` runs `TRUNCATE TABLE ${TABLES_TO_WIPE.join(', ')} RESTART IDENTITY CASCADE` without re-seeding `acct_accounts` or `acct_mappings`! Running `npm run reset-data -- confirm` completely wipes the chart of accounts and cafe-to-accounting mappings.

---

#### 13. [Major] Duplicated and diverging backend implementation between `server/src/routes/*` and `server/src/core/services/*` (Capacitor / PGlite offline build missing 15+ routes)

- **Where:**
  - `server/src/core/createCore.js` & `server/src/core/services/*.js`
  - `client/src/api/http.js` & `client/src/local/localBackend.js`
- **Confirmed by:** Reading code.
- **Details:**
  - `server/src/core/services/` only implements 13 early services (`auth`, `students`, `parameters`, `periods`, `evaluations`, `results`, `dashboard`, `groups`, `fields`, `roles`, `users`, `preferences`, `savedViews`, `audit`), whereas `server/src/routes/` has grown to include `teachers`, `intervals`, `assignments`, `sessions`, `tasks`, `taskTemplates`, `alerts`, `export`, `cafeProducts`, `cafeSuppliers`, `cafePurchases`, `cafeSales`, `cafeBalances`, `cafeInventory`, `cafeReports`, `accountingAccounts`, `accountingPeriods`, `accountingJournal`, `accountingReports`, and `agent`.
  - In addition, even the shared services have drifted (e.g., `core/services/audit.js` is missing categories; `core/services/students.js` vs `routes/students.js` identity fields). In the Capacitor/PGlite local build (`VITE_BACKEND=local`), navigating to Teachers, Schedule, Sessions, Export, Cafe, Accounting, or Agent fails because those endpoints do not exist in `createCore.js`.

---

### Minor

#### 14. [Minor] `scanAlerts()` (`server/src/lib/alerts.js`) raises false-positive `"session_unconfirmed"` alerts for past sessions that already have recorded student evaluations, and deleting a task does not bump `sessions.updated_at`

- **Where:**
  - `server/src/lib/alerts.js:12-60` (`scanAlerts`)
  - `server/src/routes/tasks.js:280-291` (`DELETE /api/tasks/:id`)
- **Confirmed by:** Reading code.
- **Details:**
  1. `scanAlerts()` (`server/src/lib/alerts.js:48-55`) flags any past session where `s.canceled_at IS NULL AND s.archived_at IS NULL AND s.note IS NULL AND NOT EXISTS (SELECT 1 FROM tasks tk WHERE tk.session_id = s.id)` as `"session_unconfirmed"` (*"passed with no record"*). However, it never checks `NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.session_id = s.id AND e.archived_at IS NULL)`. A session where the teacher entered every student's scores on `/evaluate` (without typing a session note or creating a task) is still flagged as an unconfirmed session alert!
  2. The comment at `server/src/lib/alerts.js:12-14` states: *"Deleting tasks or clearing the note bumps `s.updated_at` past `rs.resolved_at`, so a re-broken session will raise again."* However, `DELETE /api/tasks/:id` (`server/src/routes/tasks.js:283`) only runs `DELETE FROM tasks WHERE id = $1` without touching `sessions.updated_at`, so a previously resolved alert is never re-raised if all tasks for that session are deleted.

---

#### 15. [Minor] `POST /api/accounting/periods/opening` is never recorded in the audit log, and `server/src/lib/auditRules.js` contains unreachable dead rules

- **Where:**
  - `server/src/lib/auditRules.js:39-40, 57, 64`
  - `server/src/routes/accountingPeriods.js:265-298` (`POST /api/accounting/periods/opening`)
  - `server/src/lib/accountingJournal.js:240-330` (`generateOpeningEntry`)
- **Confirmed by:** Reading code.
- **Details:**
  1. `server/src/lib/auditRules.js:64` includes `/^\/api\/accounting\/periods\/opening$/` in `RECORDED_BY_THEIR_OWN_ROUTES`, which tells the global `auditRequests` middleware (`server/src/middleware/audit.js`) to skip it because the route records its own audit entry. However, neither `accountingPeriods.js:265-298` nor `generateOpeningEntry()` in `accountingJournal.js` calls `recordAudit()`! Generating the once-ever opening balance entry therefore leaves no audit trail at all (even though `client/src/lib/audit.js` and `server/src/routes/audit.js` expect `'accounting.opening_balance'`).
  2. In `server/src/lib/auditRules.js:39-40`, `RULES` defines entries for `POST /api/parameters` and `PATCH /api/parameters/:id`, which are unreachable dead code because `RECORDED_BY_THEIR_OWN_ROUTES` (`line 57`) matches `/^\/api\/parameters(\/|$)/` first.

---

#### 16. [Minor] `SchedulePage.jsx` (`formatEvery`, `nextOccurrence`) ignores `every.years` when PostgreSQL canonicalizes intervals of ≥ 12 months (`'12 months'::interval` -> `{ years: 1 }`), and PGlite returns raw `interval` strings (OID `1186`)

- **Where:**
  - `client/src/pages/SchedulePage.jsx:29-57, 459` (`formatEvery`, `nextOccurrence`, `IntervalsManager`)
  - `server/src/db/pglite.js:52-59`
- **Confirmed by:** Running type-parser probe + reading code.
- **Details:**
  1. **Intervals ≥ 12 months broken even under standard `pg` (`SchedulePage.jsx:29-57, 459`):**
     - `IntervalsManager` (`line 459`) allows creating intervals up to `24` months (`max={unit === 'months' ? 24 : 365}`).
     - When `POST /api/intervals` inserts `'12 months'::interval` or `'18 months'::interval`, PostgreSQL canonicalizes `12 months` into `1 year`, which `pg`'s `postgres-interval` parser returns as `{ years: 1 }` (or `{ years: 1, months: 6 }` for `18 months`).
     - However, `formatEvery(every, t)` (`lines 29-35`) and `nextOccurrence(anchorDate, every)` (`lines 37-57`) only inspect `every.months` and `every.days` and completely ignore `every.years`! A `12 months` interval displays `'—'` and `nextOccurrence` returns `null`, while an `18 months` interval displays `"Every 6 months"` and computes next occurrences 6 months apart instead of 18.
  2. **PGlite vs `pg` OID `1186` representation (`server/src/db/pglite.js:52-59`):**
     - `@electric-sql/pglite` returns `interval` columns (OID `1186`) as raw strings (`"7 days"`, `"1 mon"`). Without an OID `1186` parser in `pglite.js` or string support in `SchedulePage.jsx`, `every.days` is `undefined`, `formatEvery` renders `'—'`, and `nextOccurrence` returns `null`.

---

#### 17. [Minor] `AuditPage` (`client/src/lib/audit.js` + `client/src/i18n/{fa,en}/admin.json`) has no translations or `describeAudit()` handlers for any Cafe, Accounting, or Voice Agent actions — rendering raw English dot-keys (`cafe_sale.create`, `accounting_entry.post`, etc.) in the UI

- **Where:**
  - `client/src/pages/AuditPage.jsx:16-27` (`ActionText`)
  - `client/src/lib/audit.js:47-291` (`describeAudit`)
  - `client/src/i18n/fa/admin.json:204-320` & `client/src/i18n/en/admin.json:204-320` (`audit.actions`)
- **Confirmed by:** Running & visual inspection of `/audit` (`14-audit.png`).
- **Details:**
  - `describeAudit(entry)` has no `case` branches for `cafe_product.*`, `cafe_supplier.*`, `cafe_purchase.create`, `cafe_sale.create`, `cafe_sale.void`, `cafe_waste.create`, `cafe_adjustment.create`, `cafe_balance.*`, `accounting.*`, `accounting_account.*`, `accounting_mapping.update`, `accounting_period.*`, `accounting_entry.*`, or `agent.*`.
  - It falls through to `default: return [{ key: entry.action }]`, and `ActionText` calls `t('audit.actions.' + segment.key, { defaultValue: segment.key })`. Because `client/src/i18n/{fa,en}/admin.json` has **no** `cafe_*`, `accounting*`, or `agent` keys under `audit.actions`, the Audit table displays raw internal strings like `accounting_entry.post`, `cafe_waste.create`, `cafe_sale.void`, and `cafe_sale.create` directly in the Persian/English UI (confirmed in `14-audit.png`).

---

#### 18. [Minor] Custom student fields of type `date` render as raw ISO strings (`YYYY-MM-DD`) instead of localized Jalali/Gregorian dates, and saving custom fields does not invalidate `['students']`

- **Where:**
  - `client/src/components/StudentFieldsSection.jsx:11-17, 34-37`
- **Confirmed by:** Running & visual inspection of `StudentDetailPage` (`08-student-by-period.png`).
- **Details:**
  1. In `StudentFieldsSection.jsx:11-17`:
     ```js
     function displayValue(field, raw, t) {
       if (raw === undefined || raw === null || raw === '') return null;
       if (field.fieldType === 'boolean') {
         return raw ? t('common:boolean.yes') : t('common:boolean.no');
       }
       return String(raw);
     }
     ```
     When `field.fieldType === 'date'`, `displayValue` returns `String(raw)` (`"2026-02-15"`), whereas `StudentIdentitySection` right above it formats `birthDate` with `bothDates` (`۹ تیر ۱۳۸۱ (Jun 30, 2002)`).
  2. In `StudentFieldsSection.jsx:34-37`, `saveMutation.onSuccess` only invalidates `['student', student.id]` and does not invalidate `['students']`, so navigating back to `/students` or `/students/import` or `/export` serves stale `extra` custom field values until `staleTime` expires.

---

#### 19. [Minor] Mobile viewport (`390×844`) horizontal overflow on `/dashboard` caused by `.group-filter select` having no `max-width: 100%` / `min-width: 0`

- **Where:**
  - `client/src/index.css:3311-3316` (`.group-filter`)
  - `client/src/components/GroupFilter.jsx:23-41`
- **Confirmed by:** Running in Playwright at `390×844` (`15-mobile-dashboard.png`, `documentElement.scrollWidth = 409 > clientWidth = 390`, `.group-filter` `left: -34px, width: 381px`).
- **Details:**
  - `.group-filter` is `display: flex; align-items: center; gap: 0.4rem; white-space: nowrap;` inside `.toolbar` (`display: flex; flex-wrap: wrap`). Neither `.group-filter` nor its child `<select>` sets `min-width: 0` or `max-width: 100%`.
  - When a nested group has a bilingual or moderately long name (`──── کارگاه پیانو و هارمونی / Piano & Harmony`), the `<select>`'s intrinsic width is `348px`, making `<label class="group-filter">` `381px` wide inside a `326px`-wide `.toolbar` container — overflowing `34px` past the left border of the card and introducing horizontal page scroll on phones (`15-mobile-dashboard.png`).

---

#### 20. [Minor] `StudentForm.jsx` places the primary submit button (`افزودن دانش‌آموز / Add student`) on the first row *above* custom student fields (`<StudentFieldInputs />`)

- **Where:**
  - `client/src/components/StudentForm.jsx:54-74`
- **Confirmed by:** Running & visual inspection of `/students` (`03-students.png`).
- **Details:**
  - In `StudentForm.jsx:54-68`:
    ```jsx
    <div className="row">
      <input ... value={fullName} ... />
      <button type="submit" disabled={mutation.isPending}>
        {t('add.submit')}
      </button>
    </div>
    <StudentFieldInputs fields={fields} values={extra} onChange={setExtra} ... />
    ```
  - When custom student fields exist (e.g., Instrument, Enrollment Date, Scholarship, Weekly Practice, Confidential Note), the orange `افزودن دانش‌آموز` submit button sits at the very top of the card next to `fullName`, followed by 5 custom field rows below the submit button, and the validation error message at the very bottom (`03-students.png`).

---

#### 21. [Minor] `GroupsPage.jsx` uses `key={student.id}` instead of `key={student.membershipId}` when rendering `pastMembers`

- **Where:** `client/src/pages/GroupsPage.jsx:106`
- **Confirmed by:** Reading code.
- **Details:**
  - A student can join, leave, and rejoin a group across different dates, creating multiple rows in `student_group_members` with `left_on IS NOT NULL` for the same `student.id` (each with a distinct `membershipId`, selected in `server/src/routes/groups.js:415`).
  - Using `key={student.id}` in `pastMembers.map((student) => <li key={student.id}>)` triggers a duplicate React key warning and corrupts list reconciliation if a student has multiple past memberships in the same group.

---

#### 22. [Minor] `StudentBalanceSection.jsx` does not validate integer Toman input on the client before submitting, and omits `.table-wrap` around the transactions table

- **Where:** `client/src/components/StudentBalanceSection.jsx:40-47, 108-115, 139`
- **Confirmed by:** Visual inspection (`08-student-by-period.png`) + reading code.
- **Details:**
  - Unlike `CafeProductsPage.jsx` and `CafePurchasesPage.jsx` (which validate `/^\d+$/` on the client before mutating), `StudentBalanceSection.jsx:42` passes `Number(toLatinDigits(amount).replace(/[,\s٬]/g, ''))` directly to `adjustStudentBalance`, relying on the server to reject `NaN`, `0`, or fractional numbers.
  - Also, the `<button type="submit">` inside `<form>` (`StudentBalanceSection.jsx:108-115`) is a direct child of a `flex-direction: column` form without `align-self: flex-start`, stretching the submit button across 100% of the 1,100px card width (`08-student-by-period.png`), and the `<table className="table">` at line 139 is not wrapped in `<div className="table-wrap">` (same in `CafeSalesPage.jsx:361, 516`).

---

#### 23. [Minor] 12 orphaned legacy `node:test` files in `client/test/*.test.js` (4 of which fail with module-not-found / stale pre-029 assertions)

- **Where:** `client/test/*.test.js` (`cells.test.js`, `csv.test.js`, `dashboard.test.js`, `format.test.js`, `importNames.test.js`, `numbers.test.js`, `resultsView.test.js`, `roles.test.js`, `scoreImport.test.js`, `studentFields.test.js`, `theme.test.js`, `views.test.js`)
- **Confirmed by:** Running `node --test client/test/*.test.js` (**43 passing, 18 failing**).
- **Details:**
  - The client migrated its test suite to Vitest (`client/src/**/*.test.{js,jsx}`, 23 files / 204 tests passing via `npm test`), but left 12 older `node:test` files in `client/test/*.test.js`.
  - Four of those files (`cells.test.js`, `dashboard.test.js`, `roles.test.js`, `scoreImport.test.js`) are broken: `roles.test.js` imports deleted `../src/auth/roles.js` (`ERR_MODULE_NOT_FOUND`), and `cells.test.js`, `dashboard.test.js`, and `scoreImport.test.js` call pre-029 single-value signatures instead of the current quality/quantity session signatures.

---

#### 24. [Minor] `deploy/backup.sh`, `deploy/restore.sh`, and `deploy/student-panel-backup.service` lack atomic temp-file writes, `umask 077`, `--clean --if-exists`, and `-v ON_ERROR_STOP=1`, and `seedSample.js` `removeSample()` fails if sample students have Cafe rows

- **Where:**
  - `deploy/backup.sh:25-38`
  - `deploy/restore.sh:34-35`
  - `deploy/student-panel-backup.service:14-18`
  - `server/src/scripts/seedSample.js:237-247`
- **Confirmed by:** Reading code.
- **Details:**
  - `backup.sh`: `pg_dump --no-owner --no-ACL "$DATABASE_URL" | gzip >"$OUT"` creates `"$OUT"` directly before `pg_dump` finishes; if `pg_dump` fails mid-stream, a corrupt `.sql.gz` file is left in `$BACKUP_DIR` and counted toward `$KEEP=30` rotation. Neither `backup.sh` nor `student-panel-backup.service` sets `umask 077` / `UMask=0077`.
  - `restore.sh:34`: runs `gunzip -c "$FILE" | psql "$DATABASE_URL"` against a dump created without `--clean --if-exists` and without passing `-v ON_ERROR_STOP=1` or `--single-transaction` to `psql`. Restoring onto a non-empty database fails on every `CREATE TABLE` and duplicate primary key in `COPY`, yet `psql` exits `0` by default on SQL errors so `restore.sh` prints `"Restore complete."`!
  - `seedSample.js:237-247` (`npm run seed-sample -- remove`): runs `DELETE FROM students WHERE full_name LIKE 'Sample Student%'`, which fails with `23503 foreign_key_violation` (`ON DELETE RESTRICT`) if any sample student was used in Cafe sales or balance transactions.

---

### Cosmetic

#### 25. [Cosmetic] Negative-margin vertical text overlap (`-8px`) between `<h1>` and `<p class="hint">` subtitle inside `.page-head > div` on `StudentDetailPage`, `CafeSalesPage`, `AccountingReportsPage`, and other pages

- **Where:**
  - `client/src/index.css:626-638` (`h1 { margin: 0 0 var(--space-4); }`, `h1 + .hint { margin-top: calc(var(--space-2) - var(--space-4)); }`)
  - `client/src/index.css:3910-3912` (`.page-head h1 { margin: 0; }`)
  - Affected pages: `StudentDetailPage.jsx:134-141`, `CafeSalesPage.jsx:239-242`, `AccountingReportsPage.jsx:39-44`, `AccountingAccountsPage.jsx`, `AccountingJournalPage.jsx`, `AccountingPeriodsPage.jsx`, `CafeProductsPage.jsx`, `CafePurchasesPage.jsx`, `CafeInventoryPage.jsx`, `CafeReportsPage.jsx`
- **Confirmed by:** Visual inspection of `08-student-by-period.png`, `10-cafe.png`, and `12-accounting-reports.png`.
- **Details:**
  - `h1 + .hint` (`index.css:636`) sets `margin-top: calc(var(--space-2) - var(--space-4))` (`-0.5rem = -8px`), assuming `h1` has `margin-bottom: var(--space-4)` (`16px`) so the net gap is `16px - 8px = +8px`.
  - However, `.page-head h1` (`index.css:3910`) resets `margin: 0`! Whenever a page wraps `<div><h1>...</h1><p className="hint">...</p></div>` inside `.page-head`, `h1` has `0px` bottom margin while `.hint` still gets `-8px` top margin — pulling the subtitle `8px` **upward into the descenders of `<h1>`** (clearly visible in `08-student-by-period.png`, `10-cafe.png`, and `12-accounting-reports.png`).

---

#### 26. [Cosmetic] Multiple UI/CSS polish issues confirmed visually across pages

- **Where & Details (all confirmed visually in Playwright screenshots):**
  1. **Sidebar avatar `initialsOf()` includes parentheses/punctuation (`client/src/components/Layout.jsx:409-417`, confirmed in `02-dashboard.png`..`18-preferences.png`):**
     `initialsOf(name)` splits on `/\s+/` and takes `parts[0][0] + parts[parts.length - 1][0]` without stripping punctuation (`/[()[\]{}«»"']/g`). For `"مدیر سیستم (Admin)"`, `parts[2]` is `"(Admin)"`, so `parts[2][0]` is `"("`, rendering **`م(`** inside the avatar circle.
  2. **`.segmented` pill groups on `PreferencesPage` stretch across 100% of the card width (`client/src/index.css:2957, 3367-3373`, confirmed in `18-preferences.png`):**
     `.pref-group` uses `display: grid` (where default `justify-items` is `stretch`), causing `.segmented` (`حالت` / Theme and `زبان` / Language) to stretch across the full ~750px card width instead of sizing to its pills (`justify-self: start`). Also, the palette swatches on `PreferencesPage.jsx:20-85` hardcode light-mode `--pv-paper` / `--pv-surface` preview colors even when Dark mode is active.
  3. **Zero gap (`0px`) between `<label>` text and `<select>` in `.toolbar` on `EvaluatePage`, `ResultsPage`, and `ByPeriodView` (`EvaluatePage.jsx:400-420`, `ResultsPage.jsx:210-235`, `ByPeriodView.jsx:64-92`, confirmed in `05-evaluate.png`, `06-results.png`, `08-student-by-period.png`):**
     `<label>{t(...)}<select .../></label>` inside `.toolbar` has no `display: inline-flex; align-items: center; gap: 0.5rem;` (unlike `label.inline` at `index.css:2942` or `.group-filter` at `index.css:3311`), so the Persian/English label text (`تخصیص`, `جلسه`, `دوره`) touches the border of `<select>` with `0px` spacing.
  4. **`.cell.dim` (`3.75rem = 60px`) input boxes on `EvaluatePage` clip the Persian placeholder `"کیفیت"` (`client/src/index.css:3108`, `EvaluatePage.jsx:290`, confirmed in `05-evaluate.png`):**
     With horizontal padding `var(--space-3)` (`12px` each side), the inner text area of `.cell.dim` is only `36px` wide, clipping the 5-letter Persian placeholder `"کیفیت"`.
  5. **`CafeSalesPage.jsx:532` renders `s.studentCode` raw (`ST23456A`) without `formatStudentCode(s.studentCode)` (`ST23-456A`)** (confirmed in `10-cafe.png`).
  6. **Browser console deprecation warning on `/dashboard` (`THREE.Clock`):**
     `CohortConstellation.jsx` via `@react-three/fiber` + `three@0.183.2` logs `WARNING: THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.` to the browser console on every mount.

---

#### 27. [Cosmetic] Documentation drift in `CLAUDE.md` / `AGENTS.md` and `docs/audit-notes.md`

- **Where:**
  - `CLAUDE.md:258` & `AGENTS.md:258` (lists non-existent `Tasks`, `Alerts`, `CafePos`, `CafeBalances` page files instead of `SessionsPage` and `CafeSalesPage`, and omits `AgentTranscriptsPage`)
  - `docs/audit-notes.md:12, 15` (previously listed `128 / 128` client tests and `61 / 61` agent tests; actual counts are `23 files / 204 tests` in `client` and `21 tests` in `agent`)
- **Confirmed by:** Running test suites + reading code.

---

## Suggestions (Ordered by Value)

1. **[Highest Value / Quick Win] Register OID `1082` (`date` -> `'YYYY-MM-DD'`) and OID `1186` (`interval`) type parsers centrally in `server/src/db/pool.js` and `server/src/db/pglite.js`, and harden `localDateFromIso()` in `client/src/lib/locale.js`:**
   - Adding `pg.types.setTypeParser(1082, (v) => v)` in `pool.js` and `parsers: { 1082: (v) => v, 1186: ... }` in `pglite.js` fixes all 11+ client page crashes, the server-side `assignPeriods()` weekday-alphabetical sort bug, and the partial fiscal-period `PATCH` validation bug in ~15 lines of code.
   - Also normalize `String(isoDate).slice(0, 10)` in `localDateFromIso()` (`client/src/lib/locale.js:35`) as defense-in-depth, and include `(every.years ?? 0) * 12 + (every.months ?? 0)` in `SchedulePage.jsx#formatEvery` / `nextOccurrence`.
2. **[High Value / Quick Win] Fix `DashboardPage.jsx:108` (`update.mutate(...)` instead of `update(...)`):**
   - A 1-line fix (`update.mutate({ dashboardConstellation: { ...options, ...changes } })`) eliminates the immediate `TypeError: update is not a function` crash when interacting with Dashboard constellation controls.
3. **[High Value / Quick Win] Update `PREREQUISITES` in `server/src/lib/permissions.js` so `scores.enter`, `scores.view`, and `data.export` include `schedule.view` (and `scores.view` includes `students.view` + `parameters.view`, and `data.export` includes `scores.view`):**
   - Ensures custom roles (such as Blind Entry or Exporter) can load `GET /api/assignments` and `GET /api/sessions` on `/evaluate`, `/evaluate/import`, `/results`, and `/export` without hitting `403 Forbidden`.
4. **[High Value] Enforce open-period and non-closing guards when voiding posted journal entries (`025_create_accounting_core.sql`, `server/src/lib/accountingJournal.js`), and check `createPostedEntry()` errors in `closeFiscalPeriod()`:**
   - In `acct_entry_lifecycle` (`OLD.status = 'posted' AND NEW.status = 'voided'`) and `voidEntry()`, call `acct_assert_open_period(OLD.entry_date)` and forbid voiding `OLD.source_type = 'closing'` unless performed by a dedicated period-reopen flow.
   - In `closeFiscalPeriod()` (`accountingJournal.js:415-438`), handle negative (contra) income/expense balances by flipping debit/credit when `balance < 0`, remove the 100-line cap for system closing entries, and check `if (posted.error) return posted;` before marking `acct_fiscal_periods.status = 'closed'`.
5. **[High Value] Define and enforce a single deterministic multi-session period aggregation rule across `server/src/lib/results.js`, `client/src/lib/views.js`, and `client/src/lib/cube.js`, exclude `isGroupRow` from `parameterSummary()` in `client/src/lib/resultsView.js`, and fix group-evaluation / individual-assignment handling in `server/src/routes/dashboard.js`:**
   - Order period evaluations by `s.session_date ASC, s.seq ASC, e.membership_id NULLS FIRST`.
   - Ensure a later selected-but-unanswered row (`value === null`) in the same period never erases an earlier answered score from that period, apply whole-group fallback consistently in `buildResults()` and `dashboard.js#/trends`, filter `!row.isGroupRow` in `resultsView.js#parameterSummary`, and include individual assignments via `LEFT JOIN student_group_members gm ON gm.id = a.membership_id` when filtering the dashboard by `groupId`.
6. **[High Value] Fix `resetData.js` so it preserves `acct_accounts` and `acct_mappings` and seeds an initial open fiscal period (both in a new migration `031` and in `resetData.js`), and translate `P0001` closed-period trigger errors to `409 ACCOUNTING_PERIOD_CLOSED`:**
   - Remove `'acct_mappings'` and `'acct_accounts'` from `TABLES_TO_WIPE` in `server/src/scripts/resetData.js:33-34` (matching the file's own header comment), seed the current Jalali year's open fiscal period, and catch `/closed fiscal period/i` inside `postMappedEvent` / `generateOpeningEntry` in `server/src/lib/accountingJournal.js`.
7. **[High Value] Harden the Voice Agent (`agent/src/dialogue.js`, `agent/src/tools.js`, `agent/src/llm.js`, `server/src/routes/agent.js`):**
   - Match `(details->>'note' = 'voice' OR details->>'note' LIKE 'voice:%')` in `server/src/routes/agent.js:37` so `voiceSales` counts standard voice sales; call `this.publishState()` in `cancelScreen()` and on error paths in `#executeSale()`; wrap `confirmScreen()` and `#executeSale()` in `try / catch / finally { this.state.stageGate = 'closed'; }`; reset `state.phase = 'idle'` and `state.spokenConfirmed = false` inside `tools.js` (`add_to_cart`, `remove_from_cart`, `attach_student`); include `tool_call_id: call.id` in `llm.js#chatOpenAi`; guard `if (!needle) return undefined;` in `findProduct`; and use `Asia/Tehran` date in `sales_report`.
8. **[Medium Value / Quick Win] Complete Audit Log category prefix mappings, record `accounting.opening_balance` in `accountingPeriods.js`, and add `admin.json` / `describeAudit()` translations for Cafe, Accounting, and Voice Agent:**
   - Map `'cafe_inventory'` to `['cafe_inventory', 'cafe_waste', 'cafe_adjustment']` and `'accounting'` to `['accounting', 'accounting_account', 'accounting_mapping', 'accounting_entry']` in `server/src/routes/audit.js`, call `recordAudit` in `POST /api/accounting/periods/opening`, update `server/src/core/services/audit.js`, and add `cafe_*`, `accounting_*`, and `agent.*` translations to `client/src/i18n/{fa,en}/admin.json` and `client/src/lib/audit.js`.
9. **[Medium Value / Quick Win] Check `evaluations` in `scanAlerts()` (`server/src/lib/alerts.js`) and bump `sessions.updated_at` on `DELETE /api/tasks/:id` (`server/src/routes/tasks.js`):**
   - Prevents false-positive `"session_unconfirmed"` alerts on sessions that already have student scores recorded.
10. **[Medium Value / Quick Win] Exclude soft-deleted students (`s.deleted_at IS NULL`) from `cafeReports.js#getRangeReport` and `accountingJournal.js#generateOpeningEntry`:**
    - Prevents deleted student records from inflating Cafe debtor counts/totals and Accounting opening balance sheets.
11. **[Medium Value / Quick Win] Fix the CSS/layout polish issues across desktop and mobile:**
    - Add `.page-head h1 + .hint { margin-top: var(--space-1); }` in `client/src/index.css` to eliminate the `-8px` title/subtitle collision.
    - Add `.group-filter { max-width: 100%; min-width: 0; } .group-filter select { max-width: 100%; min-width: 0; flex: 1; }` to eliminate mobile horizontal overflow on `/dashboard` and `/students`.
    - Add `.pref-group .segmented { justify-self: start; }` on `PreferencesPage`.
    - Add `display: inline-flex; align-items: center; gap: 0.5rem;` to `.toolbar > label` so `<label>` text no longer touches `<select>` borders on `EvaluatePage`, `ResultsPage`, and `ByPeriodView`.
    - Move `<button type="submit">` below `<StudentFieldInputs />` in `StudentForm.jsx`, and strip punctuation in `Layout.jsx#initialsOf`.
12. **[Medium Value] Harden `deploy/backup.sh` and `deploy/restore.sh`:**
    - Set `umask 077`, write to `"$OUT.tmp"` then `mv` in `backup.sh`, and pass `--clean --if-exists` to `pg_dump` and `-v ON_ERROR_STOP=1 --single-transaction` to `psql` in `restore.sh`.
13. **[Medium Value] Remove the 12 orphaned `client/test/*.test.js` files and add an automated OID `1082`/`1186` serialization contract test to `server/src/core/`:**
    - All valid client tests already live in `client/src/**/*.test.{js,jsx}` under Vitest. Removing `client/test/` prevents confusion, and adding a PGlite serialization check ensures future routes never return uncast `Date` objects.
14. **[Larger Architectural Improvement] Unify `server/src/routes/*` and `server/src/core/services/*`:**
    - Extract shared database service functions called by both Express routes and `createCore.js` so the Capacitor/PGlite local build has full feature parity with the LAN server without duplicating SQL.

---

## What Could Not Be Checked & Why

1. **Native PostgreSQL (`psql` / `pg.Pool` over TCP) & `npm run test-permissions` against a separate external Postgres daemon:**
   - The cloud container environment does not run a standalone PostgreSQL TCP daemon (`/var/run/postgresql`). Instead, the full 30-migration schema and live server were executed against in-process PostgreSQL (PGlite / WASM Postgres) wired into `server/src/db/pool.js`, and `pg`'s own `pg-types` OID `1082`/`1186` parsers were verified directly via Node (`pg.types.getTypeParser(1082)`). Specifically, PostgreSQL-only connection pool exhaustion (`max: 10`) and `statement_timeout` (`15000ms`) under concurrent TCP load could only be verified by code inspection (`server/src/db/pool.js:10-16`).
2. **Physical Audio Hardware (`arecord` / `alsa` microphone capture) and Local Native Binaries (`whisper.cpp`, `piper`, `ollama`) for the Voice Agent (`agent/`):**
   - Physical ALSA audio capture devices and the external native binaries (`whisper-cli`, `piper`, local `ollama` daemon) are not installed in this container. We verified the `agent/` package via its 21-test automated suite (`npm --prefix agent test`) and line-by-line code audit of `agent/src/*.js`, and seeded `agent_sessions` / `agent_messages` to verify the server/client `/agent` and `/agent/transcripts` UI visually.
3. **Capacitor Android APK packaging (`npx cap sync android` / Android Studio Gradle build):**
   - Android SDK/Gradle toolchains are not present in the container, so `MOBILE.md` and `client/src/local/*` were audited by code inspection and unit/core tests (`npm --prefix server run test:core` and `npm --prefix server run verify-pglite`).
4. **Live systemd unit activation (`systemctl`) and cron/timer execution on a Linux host (`deploy/*.service`, `deploy/*.timer`, `deploy/Caddyfile`):**
   - Container PID 1 is not `systemd`, so `deploy/student-panel.service`, `deploy/student-panel-backup.service`, `deploy/student-panel-backup.timer`, `deploy/backup.sh`, `deploy/restore.sh`, and `deploy/Caddyfile` were audited by static inspection.

---

## Appendix: Previous Audit Notes (Preserved Verbatim)

# Repository Audit Notes (Problems & Suggestions)

Audited at commit `55d9e87` across `server/`, `client/`, `agent/`, `scripts/`, and `deploy/`.

---

## Verification Baseline

- **Server unit tests** (`npm --prefix server test`): **217 / 217 passing**
- **Server PGlite core service tests** (`npm --prefix server run test:core`): **54 / 54 passing**
- **Server PGlite migration & DB invariant verification** (`npm --prefix server run verify-pglite`): **30 migrations (`001`–`030`) & all invariants passing**
- **Client unit & component tests** (`npm --prefix client test`): **128 / 128 passing** (including `fa`/`en` i18n key-tree parity)
- **Client ESLint** (`npm --prefix client run lint`): **0 errors / 0 warnings**
- **Client production bundle** (`npm --prefix client run build`): **clean build to `client/dist`**
- **Agent test suite** (`npm --prefix agent test`): **61 / 61 passing**

---

## Problems (Ordered by Severity)

### 1. [Critical] Uncast PostgreSQL `date` columns (OID `1082`) deserialize as JavaScript `Date` objects, crashing `GET /api/sessions` on the server and `formatIsoDate` / `JalaliDatePicker` on the client

- **Where:**
  - `server/src/db/pool.js:10-16` & `server/src/db/pglite.js:61-66` (no OID `1082` type parser override)
  - `server/src/routes/sessions.js:18-20, 56` (`s.planned_date`, `s.moved_to`, `s.session_date` selected without `::text`)
  - `server/src/lib/periods.js:36` (`a.sessionDate.localeCompare(b.sessionDate)`)
  - `client/src/lib/locale.js:35-38` (`localDateFromIso(isoDate)`)
  - Additional uncast `date` selects in:
    - `server/src/routes/accountingPeriods.js:19-20, 105, 256` (`start_date`, `end_date`, `entry_date`)
    - `server/src/routes/accountingJournal.js:20` (`e.entry_date AS "entryDate"`)
    - `server/src/lib/accountingReports.js:54` (`e.entry_date AS "entryDate"`)
    - `server/src/routes/cafePurchases.js:22` (`pu.purchased_at AS "purchasedAt"`)
    - `server/src/lib/cafeReports.js:7` (`sold_at::date AS day`)
    - `server/src/routes/teachers.js:14` (`birth_date AS "birthDate"`)
    - `server/src/routes/assignments.js:25` (`a.anchor_date AS "anchorDate"`)
    - `server/src/routes/alerts.js:20` (`s.session_date AS "sessionDate"`)
- **Confirmed by:** Runtime execution of `pg` and `PGlite` date parsers + code trace.
- **Details:**
  1. Both `pg` and `@electric-sql/pglite` parse PostgreSQL `date` (OID `1082`) into JavaScript `Date` instances unless cast with `::text` in SQL or overridden via `setTypeParser(1082, ...)`.
  2. **Server crash (`GET /api/sessions`):** `withPeriodSeqs()` (`server/src/routes/sessions.js:56`) selects `session_date AS "sessionDate"` without `::text` and passes those rows to `assignPeriods()` (`server/src/lib/periods.js:36`), which calls `a.sessionDate.localeCompare(b.sessionDate)`. Because `sessionDate` is a `Date` instance, `localeCompare` is `undefined`, throwing `TypeError: a.sessionDate.localeCompare is not a function` (HTTP 500) whenever two or more sessions exist for an assignment.
  3. **Client crash (`RangeError: Invalid time value`):** When `Date` objects are serialized over JSON by Express, they become full ISO timestamps (`"2026-03-21T00:00:00.000Z"`). On the client, `localDateFromIso(isoDate)` (`client/src/lib/locale.js:35-38`) runs:
     ```js
     const [y, m, d] = isoDate.split('-').map(Number);
     ```
     With `"2026-03-21T00:00:00.000Z"`, `d` becomes `Number("21T00:00:00.000Z")` -> `NaN`, producing an `Invalid Date` and causing `Intl.DateTimeFormat(...).format(...)` to throw `RangeError: Invalid time value` (caught by `ErrorBoundary`) on `AccountingPeriodsPage` (immediately on load because migration `025` seeds period `1405`), `AccountingJournalPage`, `AccountingReportsPage`, `CafePurchasesPage`, `CafeReportsPage`, `TeachersPage`, and `SchedulePage`.
  4. **Server validation bug on partial period update:** In `server/src/routes/accountingPeriods.js:105, 122-126`, `PATCH /api/accounting/periods/:id` loads `start_date` and `end_date` (`Date` objects). If the request updates only `startDate` or only `endDate`, `next.startDate > next.endDate` compares a `Date` object against a `'YYYY-MM-DD'` string (which coerces the string to `NaN` and evaluates to `false`), bypassing the application-level check and falling through to the DB `CHECK (end_date >= start_date)` constraint (HTTP 500 instead of HTTP 400).
- **How to fix:**
  1. Register a custom type parser for `date` (OID `1082`) in both `server/src/db/pool.js` (`pg.types.setTypeParser(1082, (value) => value)`) and `server/src/db/pglite.js` (`parsers: { 1082: (value) => value }`) so PostgreSQL `date` columns always return `'YYYY-MM-DD'` strings across the entire application.
  2. Also harden `localDateFromIso(isoDate)` in `client/src/lib/locale.js:35-38` to slice `String(isoDate).slice(0, 10)` before splitting on `'-'`.

---

### 2. [Major] Closed fiscal period trigger exceptions during Cafe auto-posting and Opening Entry creation return unhandled `500 Internal Server Error`

- **Where:**
  - `server/src/lib/accountingJournal.js:219-223, 346-350`
  - `server/src/routes/cafeSales.js:32-49`
  - `server/src/routes/cafePurchases.js:201-218`
  - `server/src/routes/cafeBalances.js:88-107`
  - `server/src/routes/cafeInventory.js:161-198`
  - `server/src/routes/accountingPeriods.js:265-297`
- **Confirmed by:** Reading code + migration `025_create_accounting_core.sql` (`acct_entry_lifecycle` trigger).
- **Details:**
  - When a fiscal period is closed, the database trigger `acct_entry_lifecycle` (`025_create_accounting_core.sql:101-106`) raises `cannot post into a closed fiscal period (%)` whenever an entry is inserted or updated with `status = 'posted'` and an `entry_date` inside that closed period.
  - Only `POST /api/accounting/journal/:id/post` (`server/src/routes/accountingJournal.js:210-215`) catches `/closed fiscal period/` and translates it to `409 ACCOUNTING_PERIOD_CLOSED`.
  - `POST /api/accounting/periods/opening` (`server/src/routes/accountingPeriods.js:265-297`) and all four Cafe routes (`cafeSales`, `cafePurchases`, `cafeBalances`, `cafeInventory` — which call `postMappedEvent` with `status = 'posted'` inside their transaction) do not catch `/closed fiscal period/`, resulting in an unhandled `500 Internal Server Error` if the current date falls inside a closed fiscal period and accounting mappings are active.
- **How to fix:**
  - Catch `/closed fiscal period/` in `POST /api/accounting/periods/opening` and in the Cafe routes (or translate the trigger error inside `postMappedEvent` / `generateOpeningEntry` in `server/src/lib/accountingJournal.js` into a structured `{ error, code: 'ACCOUNTING_PERIOD_CLOSED', status: 409 }` error).

---

### 3. [Major] Audit log category filter mismatches emitted action prefixes for Cafe Inventory and Accounting

- **Where:**
  - `server/src/routes/audit.js:6-36, 60-61`
  - `server/src/routes/cafeInventory.js:181`
  - `server/src/lib/auditRules.js:27-32`
  - `server/src/routes/accountingJournal.js:138, 204, 244`
  - `server/src/core/services/audit.js:16-33`
  - `client/src/lib/audit.js:3-32`
- **Confirmed by:** Reading code.
- **Details:**
  - `GET /api/audit` filters categories via `split_part(a.action, '.', 1) = $n`.
  - In `server/src/routes/cafeInventory.js:181`, waste and adjustments are recorded with action `${kind === 'waste' ? 'cafe_waste' : 'cafe_adjustment'}.create`. However, `AUDIT_CATEGORIES` (`client/src/lib/audit.js:24`) only exposes `'cafe_inventory'`. Selecting **Cafe inventory** on the Audit page queries `split_part(a.action, '.', 1) = 'cafe_inventory'`, which never matches `cafe_waste.create` or `cafe_adjustment.create` (always returns 0 rows).
  - Similarly, `AUDIT_CATEGORIES` (`client/src/lib/audit.js:25`) only exposes `'accounting'` (alongside `'accounting_period'`). While `accounting.opening_balance` has prefix `'accounting'`, account changes emit `'accounting_account.*'`, mapping changes emit `'accounting_mapping.update'`, and journal entries emit `'accounting_entry.*'`. Filtering by **Accounting** on the Audit page misses all account, mapping, and journal entry actions.
  - Additionally, `server/src/core/services/audit.js:16-33` (used by the PGlite local build) has an outdated `CATEGORIES` array that is missing `task_template`, `evaluation`, `field_definition`, and all `cafe*`, `accounting*`, and `agent` categories.
- **How to fix:**
  - Expand category filtering in `server/src/routes/audit.js` and `server/src/core/services/audit.js` so that umbrella categories match their constituent prefixes (`cafe_inventory` -> `['cafe_inventory', 'cafe_waste', 'cafe_adjustment']`, `accounting` -> `['accounting', 'accounting_account', 'accounting_mapping', 'accounting_entry']`), and share a single category definition list with `server/src/lib/auditRules.js`.

---

### 4. [Major] Soft-deleted students' balances are still included in Cafe Reports debt totals and the Accounting Opening Entry snapshot

- **Where:**
  - `server/src/lib/cafeReports.js:68-73`
  - `server/src/lib/accountingJournal.js:256-261`
- **Confirmed by:** Reading code.
- **Details:**
  - When a student is soft-deleted (`students.deleted_at IS NOT NULL`), `GET /api/cafe/balances/students` (`server/src/routes/cafeBalances.js:37`) filters them out via `WHERE s.deleted_at IS NULL`.
  - However, `getRangeReport` (`server/src/lib/cafeReports.js:68-73`) computes `debtorsCount` and `totalDebt` across all rows in `student_balances WHERE balance < 0` without checking `students.deleted_at IS NULL`.
  - Likewise, `generateOpeningEntry` (`server/src/lib/accountingJournal.js:256-261`) sums `student_balances` for accounts `1110` (Student Advances Receivable) and `2110` (Student Prepayments) without excluding soft-deleted students.
- **How to fix:**
  - Join `students s ON s.id = sb.student_id WHERE s.deleted_at IS NULL` in both `server/src/lib/cafeReports.js` and `server/src/lib/accountingJournal.js`.

---

### 5. [Major] `resetData.js` wipes `acct_fiscal_periods` without re-seeding the default fiscal period

- **Where:** `server/src/scripts/resetData.js:72-116`
- **Confirmed by:** Reading code (`resetData.js` vs `025_create_accounting_core.sql:198-200`).
- **Details:**
  - Migration `025_create_accounting_core.sql` seeds the initial open fiscal period (`'1405'`, `'2026-03-21'` to `'2027-03-20'`) alongside the chart of accounts and default cafe-to-accounting mappings.
  - `resetData.js:82` truncates `acct_fiscal_periods`, and lines `97-116` re-seed `scheduling_intervals` and `acct_mappings`, but do not re-seed the default fiscal period. After running `npm run reset-data -- confirm`, no fiscal period exists until an accountant manually creates one, and any Cafe transaction (since mappings are re-seeded as `active = true`) will fail to auto-post unless a fiscal period is created or mappings are paused.
- **How to fix:**
  - Re-seed the default open fiscal period in `server/src/scripts/resetData.js` right after re-seeding `acct_mappings`.

---

### 6. [Minor] PGlite vs `pg` `interval` representation mismatch in `SchedulePage.jsx`

- **Where:**
  - `client/src/pages/SchedulePage.jsx:29-57` (`formatEvery`, `nextOccurrence`)
  - `server/src/db/pglite.js:52-59`
- **Confirmed by:** Runtime type-parser probe + reading code.
- **Details:**
  - `node-postgres` (`pg`) parses PostgreSQL `interval` columns (OID `1186`) into objects (`{ days: 7 }`, `{ months: 1 }`), which `SchedulePage.jsx` expects (`every.days`, `every.months`, `every.years`).
  - `@electric-sql/pglite` returns `interval` columns as raw PostgreSQL strings (`"7 days"`, `"1 mon"`). In a PGlite-backed build, `every` is a string, so `every.days` is `undefined`, `formatEvery` renders `'—'`, and `nextOccurrence` returns `null`.
- **How to fix:**
  - Either register an OID `1186` parser in `server/src/db/pglite.js` that returns `{ years, months, days }` objects matching `postgres-interval`, or add a small string-interval normalizer in `SchedulePage.jsx`.

---

### 7. [Minor] `server/src/scripts/seedSample.js` `removeSample()` can fail with FK constraint error if a sample student has Cafe history

- **Where:** `server/src/scripts/seedSample.js:237-247`
- **Confirmed by:** Reading code.
- **Details:**
  - `npm run seed-sample -- remove` runs `DELETE FROM students WHERE full_name LIKE 'Sample Student%'`.
  - If a developer used a sample student in the Cafe POS or Balances page during testing, `student_balances`, `student_balance_transactions`, or `cafe_sales` (`ON DELETE RESTRICT`) will reference that student, causing `removeSample()` to fail with a foreign key constraint violation.
- **How to fix:**
  - Either clean up dependent sample-student rows (or soft-delete sample students that have financial ledger rows) or catch `23503` (`foreign_key_violation`) and print a clear message explaining which sample students have immutable ledger rows.

---

### 8. [Minor] `deploy/backup.sh` pipeline can leave a truncated `.sql.gz` file on disk if `pg_dump` fails mid-stream

- **Where:** `deploy/backup.sh:30-31, 36-38`
- **Confirmed by:** Reading code.
- **Details:**
  - `pg_dump --no-owner --no-ACL "$DATABASE_URL" | gzip >"$OUT"` creates `"$OUT"` immediately. Even with `set -euo pipefail`, if `pg_dump` fails mid-stream (or cannot connect), a partial/empty `.sql.gz` file remains in `$BACKUP_DIR` with a `.sql.gz` extension. On subsequent runs, the rotation loop counts that corrupt file toward `$KEEP` (`30`) and can rotate out older valid backups.
- **How to fix:**
  - Write to `"$OUT.tmp"`, register `trap 'rm -f "$OUT.tmp"' EXIT`, verify `gzip -t "$OUT.tmp"`, and `mv "$OUT.tmp" "$OUT"` atomically before rotating old backups.

---

### 9. [Minor] `deploy/backup.sh` and `deploy/student-panel-backup.service` do not set a restrictive umask (`0077`)

- **Where:**
  - `deploy/backup.sh:25-31`
  - `deploy/student-panel-backup.service:14-18`
- **Confirmed by:** Reading code.
- **Details:**
  - While `deploy/student-panel.service` sets `UMask=0077` and hardening flags, `deploy/student-panel-backup.service` and `deploy/backup.sh` do not set a umask. Database dumps created in `/var/backups/student-panel` inherit the default `0022` umask (`0644` world-readable permissions unless the directory itself restricts traversal).
- **How to fix:**
  - Add `umask 077` at the top of `deploy/backup.sh` and `UMask=0077` / `NoNewPrivileges=true` in `deploy/student-panel-backup.service`.

---

### 10. [Cosmetic] `AuditPage` `describeAudit()` falls back to generic action title without interpolated entity details for newer Cafe and Accounting actions

- **Where:**
  - `client/src/pages/AuditPage.jsx:50-101`
  - `client/src/lib/audit.js:47-291`
- **Confirmed by:** Reading code.
- **Details:**
  - `describeAudit(entry)` builds rich, human-readable descriptions with interpolated parameters (`name`, `code`, `amount`, etc.) for pre-Cafe actions (`student.*`, `parameter.*`, `evaluation.*`, `user.*`, `role.*`, `group.*`, `field_definition.*`, `teacher.*`, `interval.*`, `assignment.*`, `session.*`, `task.*`, `task_template.*`, `alert.*`), but has no `case` branches for `cafe_*` or `accounting_*` actions.
  - Those actions hit `default: return [{ key: entry.action }]`, which translates the static label in `client/src/i18n/{fa,en}/audit.json` (e.g., `"Sale recorded"`, `"Journal entry posted"`) without showing the receipt/entry number, product name, student name, or Toman amount stored in `entry.details`.
- **How to fix:**
  - Add `case` branches in `describeAudit()` (`client/src/lib/audit.js`) and corresponding parameterized strings in `client/src/i18n/{fa,en}/audit.json` for `cafe_*` and `accounting_*` audit entries.

---

## Suggestions (Ordered by Value)

1. **[Quick Win] Centralize PostgreSQL `date` (OID `1082`) type parsing in `pool.js` and `pglite.js`:**
   Adding `pg.types.setTypeParser(1082, (v) => v)` in `server/src/db/pool.js` and `parsers: { 1082: (v) => v }` in `server/src/db/pglite.js` eliminates an entire class of `Date` vs `'YYYY-MM-DD'` serialization bugs across all routes (`sessions`, `accountingPeriods`, `accountingJournal`, `accountingReports`, `cafePurchases`, `cafeReports`, `teachers`, `assignments`, `alerts`) in ~6 lines of code.
2. **[Quick Win] Atomic backup writes and `umask 077` in `deploy/backup.sh`:**
   Writing to `"$OUT.tmp"` with a cleanup trap and `umask 077` guarantees that failed `pg_dump` runs never leave corrupt `.sql.gz` files or world-readable database dumps in `/var/backups/student-panel`.
3. **[Quick Win] Unify Audit Category mappings between `auditRules.js`, `routes/audit.js`, and `core/services/audit.js`:**
   Defining the category-to-action-prefix map in `server/src/lib/auditRules.js` and importing it in both `routes/audit.js` and `core/services/audit.js` prevents drift when new modules are added.
4. **[Larger Improvement] Consolidate Express routes (`server/src/routes/*`) and Local Core Services (`server/src/core/services/*`):**
   Currently, SQL queries and validation flows for `students`, `parameters`, `evaluations`, `groups`, `fields`, `users`, `roles`, `audit`, etc. are duplicated between `server/src/routes/` and `server/src/core/services/`, while newer modules (`teachers`, `intervals`, `assignments`, `sessions`, `tasks`, `alerts`, `cafe*`, `accounting*`) only exist in `server/src/routes/`. Sharing service functions between Express routes and the PGlite local adapter would cut duplicated SQL in half and bring the offline/Capacitor build to full feature parity.
5. **[Larger Improvement] Add an automated API serialization contract test for `date` and `interval` columns in `verify-pglite` / `test:core`:**
   Because unit tests mock `pool.query` with plain strings while real PostgreSQL/PGlite applies OID type parsers, adding a lightweight integration test in `test:core` that seeds a session, fiscal period, purchase, and journal entry and asserts `/^\d{4}-\d{2}-\d{2}$/` on returned date fields will catch any future type-parser regressions automatically.
