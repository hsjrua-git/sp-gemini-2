# sp-gemini-2 — server-error repair and release verification

Date: **2026-10-30**. Worktree: `sp-gemini-1`, branch `audit-fixes`.
Implementation baseline: `e3c6720`; server-readiness fix: **`4d0c87d`**.
Method: real-schema inspection, restored-backup reproduction, automated tests,
authenticated API requests, and production-built browser interaction.

## Fixed: [High] task pages failed against the normally configured database

**Where:** `server/src/routes/taskTemplates.js:31–33`,
`server/src/routes/tasks.js:25–39,68–83`; former health check in
`server/src/index.js:167–174`.

**Confirmed by running:** normal `server/.env` targeted
`127.0.0.1:5432/sp_gemini_1_audit`, with only migrations 001–035. PostgreSQL MCP
confirmed the missing checklist/note columns. A full backup was restored into
isolated `student_panel_upgrade_checks` on port 55439. With the current code,
`/api/task-templates` and `/api/tasks?sessionId=<valid UUID>` both returned
**HTTP 500 / PostgreSQL 42703**, while `/api/health` misleadingly returned 200.
The user's precise original failing action was unspecified; this is a directly
reproduced matching cause, not a claim that every past error had this cause.

**Repair:** with the user's explicit local-upgrade authorization, checked that
all **573** evaluations were compatible with percentage quality (zero outside
0–100), backed up/restored, tested migrations 036/037 on the clone, then applied
them to the normal database. All **40 original table row sets** retained their
pre-upgrade hashes when projecting their original columns. Only the migration
records, parameter-hierarchy lock and new default checklist/note columns were
added. Scores were not rescaled. Subsequent login/session/audit activity is
outside this immediately-after-migration data-preservation comparison.

The backup is retained locally at
`backups/sp-gemini-2-pre-upgrade-2026-10-30/database.dump` (git-ignored, private
permissions); its verified copy was restored successfully. No backup or real
environment secrets are included in the publication.

`server/src/middleware/databaseReady.js` now checks required migration filenames
before session/auth/feature SQL. Missing migrations yield HTTP 503 with
`DATABASE_MIGRATIONS_PENDING`; database outages have a distinct sanitized code.
Both messages have English/Persian translations. Health performs a fresh check;
ordinary requests share a five-second cache. The running process recovers after
maintenance migrations without requiring a restart. Startup prints actionable
instructions; migration execution remains an explicit maintenance operation.
Regression tests cover missing intermediate migrations, uninitialized schemas,
outages, concurrent checks, cache expiry, pre-session blocking and recovery.

## Environment and verification baseline

- Normal app: **`http://localhost:3000`**, normal `npm start`, upgraded configured
  database. Before verification activity: 30 students, 2 groups, 7 parameters,
  3 teachers, 5 assignments, 71 sessions, 13 periods, 573 evaluations, 2 tasks.
- Isolated release app: `http://localhost:3302`,
  `student_panel_release_checks` on 55439, cloned from `student_panel_workflows`.
  Initial fixture: 30 students, 4 groups, 6 parameters, 71 sessions, 13 periods,
  573 evaluations and 6 tasks; workflow probes add disposable records.
- Upgrade-reproduction clone: `student_panel_upgrade_checks`, API port 3303.
  Original protected `student_panel_audit` and earlier evidence remain preserved.

Evidence is under [`audit/release-2026-10-30/`](../audit/release-2026-10-30/).

| Command/check | Result | Evidence basename |
| --- | --- | --- |
| Client lint, tests, production build after translations | **246 tests**, lint/build pass | `client-final-checks` |
| Server unit suite after readiness fix | **156 pass**, 6 integration-gated skips | `server-final-unit` |
| PGlite core suite | **57/57** | `server-checks` |
| PGlite migrations/sanity checks | **37 migrations**, pass | `server-checks` |
| Agent suite | **37/37** | `agent-tests` |
| Permission integration after readiness fix | **6/6** | `final-permissions` |
| Workflow smoke | **11**, including exact previews and 880-cell Results/Export equality | `integration-smokes` |
| Café stock / sales / reports | **6 / 8 / 5** | `integration-smokes` |
| Alerts / real-PG race invariants / accounting | **6 / 5 / 9** | `integration-smokes` |
| Full backup and restore | Pass | `database-backup`, `backup-restore` |
| Stale schema before / guarded / upgraded | Reproduced 500; clear 503; repaired 200 | `stale-schema-before`, `stale-schema-guarded`, `clone-repaired` |
| Clone / normal configured database migration | 036/037 applied | `clone-upgrade`, `configured-database-upgrade` |
| Original configured data preservation | **40 table row sets** match | `configured-data-preservation` |
| Authenticated reads on restored clone / normal app / release fixture | **59/59 HTTP 200** each | `clone-api-sweep-corrected`, `configured-api-sweep`, `release-api-sweep` |
| Normal-app browser sweep | **32 routes**, zero errors/overflow; login and root redirect also checked | `live-checks.md` |

Totals: **502 passing tests plus 50 smoke assertions** (counting each suite once).
Business-workflow/ledger smokes preceded the readiness-only source fix; the final
permission suite, 59-read sweeps and normal-app browser checks exercise that fix.
One initial audit-script café-report request omitted required date filters and
correctly received HTTP 400; the corrected full sweep passed. Both receipts
are retained, rather than relabeling this probe mistake as a product defect.

## Requested-workflow reconciliation

The detailed implementation/acceptance record remains
[`student-workflows-2026-10-30.md`](student-workflows-2026-10-30.md).

| Requested area | Release-pass confirmation |
| --- | --- |
| Shared reporting scope, separate quality/quantity, charts/exports | Component suites; 880-cell workflow equality; Dashboard, Results, Export and Student Detail live reads/rendering |
| Hierarchy editing/browsing and multi-target assignments | Component suites; hierarchy guards and all-or-nothing target smoke; Groups/Parameters/Schedule live rendering |
| Identity fields and interactive Shamsi/Gregorian dates | Component suites; populated Student Detail and date-bearing scheduling/evaluation pages render |
| Exact generation previews/confirmation | Boundary, distant/month-end, exact-date/code and concurrent-confirmation smokes |
| Independent reusable checklist assignments and template page | Snapshot/progress/permission smoke; normal template editing/cancel and existing completed task display after upgrade |
| Selectable spaced/paged 3D, reduced background rendering | Current component suites retain coverage; normal Dashboard canvas observed; earlier interaction/performance evidence retained |

This release pass adds a normal-configuration upgrade and broader live/API/ledger
verification to the earlier workflow checks. It does not replace the original
download, hierarchy interaction or locked-score restoration evidence.

## Prior audits, preservation and remaining limits

[`docs/audit-notes.md`](audit-notes.md) is historical; its blanket closure claims
remain qualified by [`audit/PRIOR_AUDIT_RECONCILIATION.md`](../audit/PRIOR_AUDIT_RECONCILIATION.md),
[`audit/FIX_LOG.md`](../audit/FIX_LOG.md), and the workflow report. Today's café,
accounting and effective-report checks pass. **A09/A12/A23/A24 remain deferred**:
kiosk void confirmation policy, refund/ledger semantics, partial-import contract,
and deployment-role grants were not resolved by the database-upgrade permission.

The earlier measured **3.6–3.75 s cold 3D startup** remains the last comparable
measurement. Actual mobile/device behavior, real hidden-tab suspension,
spreadsheet-application interoperability, screen readers/cross-browser behavior,
Android/audio/model providers, Windows/full installer authentication and sustained
load/storage-exhaustion checks retain their previously documented limits.

Preservation checks retain the original 629-file non-secret inventory, all 295
protected original evidence files, all six supplied handoff/schema hashes, and
all 26 earlier workflow capture hashes. Supplied handoffs and `partly-schema/`
remain local/untracked. New captures/log snapshots have their own hash manifest.

Publication target: private **`hsjrua-git/sp-gemini-2`**, with the verified branch
published as `main`; GitHub verification is recorded in the publication receipt.
The normal app at port 3000 and isolated review app at port 3302 remain running.
