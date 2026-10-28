# Full post-Gemini audit — `sp-gemini-1` — 2026-10-28

Audited repository: `https://github.com/hsjrua-git/sp-gemini-1`

Audited commit: `9835dd04de8ae9f38be11d7593e6e458e17918f4`

Method: source and documentation reconciliation, comparison with remediated
`sp-gemini` commit `b790feb`, fresh PostgreSQL 16 database/migrations, PGlite,
unit/integration/live smokes, committed-vs-calculated accounting probes,
two-connection concurrency probes, authenticated API and browser route sweeps,
network/console inspection, narrow viewport, and Lighthouse.

The audit used disposable databases `sp_gemini_1_audit` and
`sp_gemini_1_probe`. The probe database was dropped after the destructive race
tests. No pre-existing database was modified.

## What changed relative to `sp-gemini`

`sp-gemini-1` is not a renamed continuation. It has a new two-commit history and
an alternative Gemini remediation. It contains several real fixes, but removes
migration 031, package-local env templates, connected sample modules, mobile
dependencies/scripts, error-coverage tests, FK indexes, and the prior
post-remediation audit. It also adds a root AI Studio app/harness, a public
source ZIP, 18 screenshots, and `.aistudio` planning artifacts.

No work from the old repository is assumed correct here; every item below was
rechecked against `9835dd0`.

## Audit environment and representative data

- Real server: Express on `127.0.0.1:3000`, PostgreSQL 16.15.
- 30 migrations applied from scratch; sample seed created 30 students, 2 groups,
  3 teachers, 4 assignments, 61 sessions, 17 periods, and 528 evaluation cells.
- Representative restricted field, identity date, membership history, cafe
  product/supplier/purchase/sale/balance, fiscal period/opening entry, alerts,
  audit actions, and voice transcripts were added through the real API/DB.
- Browser sweep covered every routed page at 454×612 after authenticated login.

## Verification baseline

| Check | Result at `9835dd0` |
| --- | --- |
| Server unit suite | **135 pass, 4 gated skips, 0 fail** |
| PGlite core services | **54/54 pass** |
| PGlite migration verifier | **30/30 migrations, shipped checks pass** |
| Client Vitest | **204/204 pass** across 23 files |
| Client ESLint / production build | clean / succeeds (1,015 modules) |
| Agent unit suite | **21/21 pass** |
| Admin API smoke | **50/50 pass** |
| Permission integration | **4/4 pass**, but leaves domain rows behind |
| Accounting smoke | passes, with deprecated concurrent same-client queries |
| Cafe sales/reports/stock smokes | 6/6, 5/5, 6/6 pass |
| Alerts smoke | **fails immediately** (`student_groups.code` NULL) |
| Agent direct live smoke | 5/5 pass |
| `npm run smoke` in `agent/` | **fails** (does not load database env) |
| Production dependency audits | 0 known vulnerabilities |
| Browser route sweep | 31/31 render; no boundary/console error/overflow |
| Lighthouse student detail | accessibility 1.00, best practices 1.00, SEO 0.80 |

Green suites do not cover the failures below. The accounting/concurrency probes
used real committed PostgreSQL transactions, then discarded the probe database.

---

# Problems, ordered by severity

## 1. [Critical accounting integrity — confirmed running] Migration 030 leaves five cross-transaction/lifecycle failures

**Where**

- `server/src/db/migrations/030_audit_fixes.sql`
- `server/src/lib/accountingJournal.js`
- migration 025 source indexes/triggers

**Reproduced on disposable real PostgreSQL:**

1. Two concurrent overlapping fiscal periods both committed.
2. A concurrent parameter-range narrowing and out-of-range evaluation insert
   both committed.
3. Two concurrent opening requests both posted; count became **2** because
   `('opening', NULL)` is not unique under normal NULL semantics.
4. A posted opening entry could be voided; only `closing` is protected.
5. Reopen → late posting → re-close failed with unique violation `23505` because
   the first posted closing entry occupies `(source_type, source_id)` forever.

The accounting smoke also still emits pg's deprecation warning because
`generateOpeningEntry()` runs `Promise.all()` queries on one checked-out client.

**Fix:** one forward migration with serialized invariant locks, once-ever
opening index, repeatable closing source semantics, closed-period locks, and
immutable opening/closing entries; sequential journal queries; real race smoke.

## 2. [Critical report correctness — confirmed running] Fiscal close erases the Income Statement

`incomeStatement()` aggregates the automatic closing entry along with business
activity. Probe result: net profit **100 before close, 0 after close**. Historical
closed-period P&L is therefore unusable even though the ledger is balanced.

**Fix:** exclude `source_type='closing'` from Income Statement only. Keep closing
lines in Trial Balance, General Ledger, Balance Sheet, and re-close math.

## 3. [Critical money integrity — confirmed running] Valid cafe input silently rounds bigint money

Current validation accepts price `999999999999` and quantity `10001`.

```text
exact item sum: 10000999999989999
stored sale:    10000999999990000
journal:        10000999999990000
safe integer:   false
```

`cafeSale`, balances, purchases, inventory, cafe reports, journal, and
accounting reports convert PostgreSQL bigint strings to JavaScript `Number`.

**Fix:** centralized exact safe-money conversion, BigInt accumulation for
validation, and transaction rollback/error if the current numeric API cannot
represent an aggregate exactly. Long term, move the API to decimal strings.

## 4. [Critical deployment/security — confirmed by entrypoint code] Root `npm start` launches a public audit harness with known credentials

The repository's default root scripts run `live-audit-server.mjs`, not the
production server. That harness:

- sets a hardcoded session secret,
- disables secure cookies and CSRF Origin checks,
- removes `frame-ancestors 'none'` from CSP,
- binds the normal server default (`0.0.0.0`),
- creates an `admin` account and other users with predictable static passwords,
- prints the credentials,
- installs dependencies/builds at runtime,
- monkey-patches the production pg pool to in-memory PGlite.

The same commit tracks a 1.1 MB public source ZIP, 18 audit screenshots, a root
empty React/Vite stub, Google-AI/Tailwind dependencies, and AI Studio plans.
A platform that runs root `npm start` exposes an audit environment, not Student
Panel production.

**Fix:** remove preview-only root app/server/archive/screenshots/artifacts;
restore the real package entrypoints and keep audit evidence under docs only.

## 5. [Major availability/integrity — confirmed running] Concurrent group/account moves commit cycles

Two transactions committed A→B and B→A for both `student_groups` and
`acct_accounts`. Group recursive `UNION ALL` queries can then run until the
15-second statement timeout.

**Fix:** serialized database hierarchy triggers plus friendly route errors and a
two-connection regression smoke.

## 6. [Major financial lifecycle — confirmed running] Archiving can hide money, and a later void recreates hidden balance

Student DELETE is a plain soft-delete with no balance check. Gemini then changed
reports/opening to exclude deleted students, so archiving a debtor makes a real
obligation disappear from operational and opening totals.

Even if the balance is first settled to zero, a later sale void succeeds and
recreates a positive hidden balance. Probe: archived student balance became
`1000` after void.

**Fix:** transactionally refuse archival while balance is non-zero, enforce it
with a DB trigger, serialize sales/balance changes/voids on the student row, and
refuse student-sale void after archival. Financial totals should include every
valid balance; obligations do not disappear through archival.

## 7. [Major authorization — confirmed running] Accounting close and opening permissions are incoherent

A role holding the full `accounting.close` prerequisite ladder but not
`accounting.manage` received **403** on close. The outer POST mount requires
manage before the route's close guard. Conversely, a manage-only role reached
the posted opening workflow (409 “already exists”, not 403) without
`accounting.post`.

**Fix:** route-specific POST guards; close/reopen depend on close, period creation
on manage, opening on manage + post. Client controls must mirror this.

## 8. [Major privacy — confirmed running] Restricted fields leak through audit details

An audit-only role without `fields.view_restricted` read
`RESTRICTED-PROBE` from nested `details.request.extra`. Generic audit request,
response, and row snapshots bypass the field privacy gate.

**Fix:** recursively strip restricted field IDs from audit details/old/new data
at read time unless the caller has the restricted-field permission.

## 9. [Major product mismatch — confirmed running] Dashboard constellation defaults empty and lacks required controls/scope consistency

The seed has 53 answered cells in period 1 and 36 in period 2, but Dashboard
defaults to generated future period 4 with zero answers, so no hero or
constellation renders until the user discovers and changes the collapsed
options panel.

Additional mismatches:

- group filter affects trends only; assignment/results/constellation remain a
  different group,
- group is not persisted,
- completion's selected dimension is ignored (`answered()` counts either
  quality or quantity and either dimension's comments),
- ring coverage uses numeric values rather than the selected completion basis,
- 3D silently truncates parameters to 12,
- no persisted Auto/3D/2D capability override or rotation control.

Changing period now works (Gemini fixed `update.mutate`) and WebGL renders, but
the requested constellation behavior is incomplete.

## 10. [Major mobile/documentation mismatch — confirmed running/build command]

`MOBILE.md` says Capacitor dependencies and `cap:*` scripts are committed and
the whole app works offline. In fact:

- `npm run cap:add:android` reports “Missing script”,
- no Capacitor dependency is declared,
- `initLocalDb()` and `callService()` have zero call sites,
- every real resource API still uses HTTP,
- newer modules have no core services,
- `bootstrap.js` cannot import outside Vite alias resolution.

**Fix:** honor the approved connected-companion design: add Capacitor scripts,
explicit HTTPS API origin/native cookies, remove unwired offline adapters and
PGlite from the client, and rewrite MOBILE.md truthfully.

## 11. [Major setup regression — confirmed running] Normal npm commands cannot read `server/.env`

`npm start` exits with “SESSION_SECRET is missing” despite valid
`server/.env`; migrate/seed/reset/create-user have the same issue. The automated
installer's final `npm start` therefore fails. `server/.env.example` and
`agent/.env.example` are deleted; root `.env.example` instead documents an
unused Gemini API key.

README also promises PostgreSQL 14 although migration 029 requires PostgreSQL
15 (`NULLS NOT DISTINCT`), and setup accepts Node versions unsupported by Vite
8 (`^20.19 || >=22.12` required).

## 12. [Major least-privilege regression — confirmed by permission expansion]

Gemini solved score-page 403s by making `scores.enter` and `scores.view` imply
the broad `schedule.view` key. A blind-entry scorer now receives the full
Schedule/Sessions navigation and schedule API rather than minimal assignment
context. This contradicts the documented blind-entry precedent.

**Fix:** restore narrow score/dashboard/export read access on assignment/session
context endpoints without granting schedule navigation; keep export prerequisites
for students/scores/parameters.

## 13. [Moderate verification/data hygiene — confirmed running]

- Permission integration uses valid POST bodies and left `Permission Test`,
  `x`, and `PERM_X` rows in the audit database.
- It covers only a subset of routes and uses nonexistent `/api/agent`.
- `alertsSmoke` fails because its group insert omits required `code`.
- Agent `npm run smoke` does not load a database URL.
- API/accounting smoke dates use UTC rather than the app's local day.
- `verify-pglite` proves only single-connection checks and misses every race.

## 14. [Moderate privacy/operations — confirmed running]

- Morgan logs full query strings; live logs contain student-name searches.
- Agent transcript directory/file modes are 0775/0664.
- Agent docs call the system fully local while remote LLM/STT/TTS endpoints can
  send dialogue, names, balances, text, and audio off-LAN.
- `resetData` does not count or clear `voice_transcripts`.

## 15. [Moderate performance/accessibility — confirmed browser]

- Signed-out `/login` downloads **75 script chunks**, including charts and every
  admin/accounting page, because App preloads all lazy routes unconditionally.
- Manual chart chunking also makes the 124 KB-gzip charts chunk an entry preload.
- After SPA navigation, focus falls to `BODY`; the new h1 is not announced and
  `document.title` remains “Student Panel”.
- Cached route choreography takes roughly 1.7 seconds and shows stale outgoing
  content for about 1.2 seconds.

## 16. [Moderate schema/runtime hardening gaps]

- 17 foreign-key columns lack leading indexes.
- Duplicate `set_updated_at` triggers exist on parameters and groups.
- GET periods/results call `syncAssignmentPeriods()` and write during reads.
- Opening generation still runs concurrent queries on one pg client.
- Accounting mapping permits same debit/credit accounts.
- Global error handler lacks `headersSent`, stable JSON parse/size codes, and
  centralized closed-period translation.
- `/api/health` does not test the database.

## 17. [Moderate/minor dead code and localization drift]

- `secrets.js` imports undeclared `argon2` and cannot load.
- 15 emitted error codes have no Persian/English translation; parity tests do
  not compare server codes.
- Dead `views.share`, `settings.manage`, parameter-change APIs/categories, and
  period-anchor translations remain after schema 4.
- README/AGENTS/voice architecture still describe removed periods/change
  history and unimplemented/contradictory agent/mobile states.
- Parameters and Export UI display stale change-history wording.
- Results summary statistics include the synthetic whole-group row.
- NotFound/error-only pages have no h1.

## 18. [Minor recovery/repository issues]

- Backup temp name is not concurrency-unique and is not verified with `gzip -t`;
  restore does not preflight gzip integrity.
- Root/client/server dependency roles are duplicated and contradictory.
- Package-local lock/template files are missing for agent/server env workflows.

---

# Reconciliation with Gemini documents

## `docs/audit-notes.md`

Verified fixed: global date/interval parsing, multi-session result ordering,
Dashboard mutation invocation, closed-period/closing-entry void checks,
contra-balance close handling, alert query logic, task-delete session bump,
audit umbrella categories, custom-field date display/cache invalidation, group
membership keys, several agent state/tool fixes, and basic atomic backup /
transactional restore behavior.

Still open or incorrectly dispositioned: concurrency-safe overlap/range,
opening uniqueness/immutability, re-close, income statement close behavior,
student financial archival policy, mobile implementation, reset transcripts,
test/smoke hygiene, setup env loading, dead schema-4 concepts, FK indexes, and
repository contamination.

## `docs/audit-remediation-report.md`

The report accurately lists many source changes, but overstates completion. It
explicitly did not run real PostgreSQL integration, which is where the critical
races and lifecycle failures reproduce. Its statement that the repository is
ready to push conflicts with the root preview harness, known credentials,
missing production env templates, broken npm scripts, and false mobile docs.

---

# Remediation plan

1. **Repository/product boundary** — remove AI Studio preview app, source ZIP,
   screenshots and planning artifacts; restore package-local production entry
   points/templates/locks.
2. **Forward DB migrations** — serialize fiscal/range/hierarchy invariants,
   enforce opening uniqueness/system-entry immutability/student balance rules,
   correct closing uniqueness, mapping checks and FK indexes; clean duplicate
   triggers/dead permissions/settings.
3. **Accounting/cafe engine** — exact money guards, correct closed-period P&L,
   re-close, sequential queries, archived-student lifecycle, stable DB errors,
   route-specific accounting permissions.
4. **Authorization/privacy** — minimal assignment/session context for score
   roles, restricted audit redaction, query-string-safe logging, private agent
   transcript files and explicit remote-provider warnings.
5. **Connected fixtures and verification** — restore all-module sample world,
   deterministic non-polluting permission/API/live/race smokes, transcript reset,
   PGlite checks, clean seed removal.
6. **Dashboard/constellation** — newest populated default, coherent persisted
   group/assignment/period/dimension/basis scope, exact completion semantics,
   all rings, Auto/3D/2D and rotation controls.
7. **Client/mobile/accessibility** — connected Capacitor companion, remove dead
   offline path, stop anonymous blanket preload/chart entry preload, route title
   and focus, h1/error-state cleanup, Results group-stat correction.
8. **Setup/recovery/docs** — env loading, Node/PostgreSQL floors, installer DB
   version check, backup integrity, complete README/AGENTS/MOBILE/agent/voice
   reconciliation, localized error coverage.
9. **Release gate** — fresh PostgreSQL migrate→seed→remove, all test suites,
   PGlite, permission/API/live/race smokes, audits, lint/build, Capacitor sync,
   full browser route/console/overflow/focus/constellation sweep; commit/push.

# Final disposition — 2026-10-29

All confirmed findings 1–18 are resolved. The remediation was applied to this
`sp-gemini-1` repository by forward migrations and code/docs changes; the old
comparison workspace was not treated as authoritative.

- **Repository/product boundary:** AI Studio preview/source artifacts and root
  stub app removed; package-local locks/env templates and production entry
  points restored. No real env file, dump, archive, dependency tree, or build
  output is tracked.
- **Database/schema:** migrations 031–035 serialize fiscal/range/hierarchy and
  answered-period races, enforce accounting/system-entry/reference/lifecycle
  invariants, add missing FK indexes, and apply schema 4's persisted
  `sessions.period_id`, attachment/detachment/reactivation, status/summary/
  analysis views, selected-cell completion, membership-date targeting, and
  race-safe alert synchronization. App-only modules and two comments remain.
- **Accounting/cafe:** exact bigint conversion, closed-book/re-close/opening
  behavior, archived-student financial guards, sequential journal writes,
  permissions, mappings and report semantics are corrected and live-smoked.
- **Authorization/privacy/operations:** blind score-entry least privilege is
  restored; restricted audit fields and query strings are redacted; transcript
  modes/provider boundaries, health checks, stable errors, backup integrity and
  restore preflight are documented/enforced.
- **Fixtures/mobile/client:** connected fixtures cover every module and remove
  cleanly even after locks expire. Capacitor is a connected companion (dead
  local-PGlite client adapters removed). Route preloading, titles, heading focus,
  result statistics, constellation scope/defaults/controls, exact period
  membership, localization parity and narrow-layout overflow are corrected.
- **Setup/docs:** Node/PostgreSQL floors, env loading, installer checks,
  executable recovery scripts, security-role example, README/AGENTS/MOBILE and
  voice-provider claims now match runtime behavior.

Final release evidence: fresh isolated real-PostgreSQL schema with all 35
migrations → connected seed (zero period violations/over-capacity) → clean
remove; PGlite migration verifier; 141 server tests (135 pass + 6 gated), 55
core tests, 214 client tests, 21 agent tests, 6/6 permission integrations,
52/52 API reads, accounting/cafe/alert/agent smokes, five real two-connection
race checks, zero production-dependency audit findings, lint/build, Capacitor
Android add/sync, compressed backup verification, and every SPA route without
an error boundary or horizontal overflow at the browser harness's 454 px floor.

# Suggestions, ordered by value

1. Move monetary API fields to decimal strings long-term; immediate safe-integer
   rejection prevents corruption but intentionally narrows bigint's API range.
2. Run real-PostgreSQL race smokes in CI; PGlite cannot prove concurrency.
3. Generate the route/permission smoke inventory from a manifest to prevent
   endpoint drift.
4. Shorten the route animation after correctness/focus repair.
5. Add transcript retention/rotation and a dedicated least-privilege transcript
   DB role.
6. Compile Android with pinned JDK/SDK in CI; Capacitor sync is not an APK test.
7. Add a clean-install matrix at exact minimum Node/PostgreSQL versions.

# Not fully verifiable here

- Signed Android APK/AAB and iOS builds (no Android SDK/Xcode).
- Physical mic/speaker, Whisper/Piper/Ollama and remote provider quality.
- NVDA/Orca manual announcement behavior, Firefox/Safari, and long soak/load.
