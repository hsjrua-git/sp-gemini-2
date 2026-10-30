# Student workflows — implementation and local verification

Date: **2026-10-30**. Repository: `sp-gemini-1`, branch `audit-fixes`.
Baseline: `2338494`. Implementation: **`1ab6179`** (124 source/test files).
The requested workflows are implemented and locally verified within the limits
below. Cold 3D startup remains approximately 3.6–3.75 seconds.

Method: source/schema inspection, unit/component tests, real PostgreSQL and
PGlite checks, and interaction with the production-built SPA in Chromium.
The [live record](../audit/workflows-2026-10-30/live-checks.md) identifies the
browser observations and retained captures. All commits and evidence are local.

## Environment and data

- PostgreSQL MCP: `127.0.0.1:5432/sp_gemini_1_audit`, inspected read-only.
- Isolated fixture: `127.0.0.1:55439/student_panel_workflows`; all **37**
  migrations applied. Browser/regression writes used its disposable clone,
  `student_panel_workflow_checks`, owned by `audit_owner`.
- Initial fixture: **30** students with complete identity fields, **4** nested
  groups, **6** hierarchical parameters, **3** teachers, **5** assignments,
  **71** sessions, **13** answered periods, **573** evaluation cells and **6**
  tasks, plus connected cafe/accounting/agent fixtures. These are pre-probe
  counts; the disposable clone subsequently gained schedules, sessions and tasks.
- Built client served by the production API at `http://localhost:3302`.
  Browser accounts: `sample-admin` and `sample-viewer`; HTTP checks also used
  `sample-staff`. These are synthetic sample accounts.
- Main live viewport: **1233 × 887**. English and targeted Persian/RTL checks.
  Narrow-container probes are described separately below.
- The earlier `127.0.0.1:55439/student_panel_audit` and supplied schema/handoff
  files were preserved.

## Acceptance results

- [x] Shared multi-group, multi-assignment, multi-period and quality/quantity
  selections in Dashboard, Results and Export, with explicit hierarchy labels.
  Student Detail history, charts and CSV use exact assignment-period selections.
- [x] Dashboard overview, 2D/3D, drawers and trends use the selected scope.
  Selected 3D loads through a placeholder; two cold captures observed no 2D flash.
- [x] Parameter selection and spaced 3D orbits: six per page, inner-to-outer
  clickable legend, fixed spacing, responsive camera/shell fitting and pagination.
- [x] Reusable expandable hierarchy pickers, group-based student browsing,
  multi-group/student selection and transactional multi-target assignments.
- [x] Student creation/editing exposes identity fields; teacher/schema differences
  were checked against the supplied reference and installed schema.
- [x] Interactive Shamsi calendar beside Gregorian entry: month/year navigation,
  bounds, keyboard navigation, Escape/focus restoration and invalid-draft handling.
- [x] Session generation explains planned versus answered sessions, previews
  exact targets/dates/codes, supports start/end or session/period counts and
  requires explicit confirmation of the current preview.
- [x] Dedicated `/task-templates` page for reusable checklist definitions;
  Sessions assigns independent snapshots to multiple targets. Evaluation shows
  current and previous-session tasks, progress, completion timestamps and notes.
- [x] Parameter-parent editing with database cycle/archive guards; quality
  **0–100%** independent of quantity bounds in validation, entry, imports,
  heatmaps, reports and exports.
- [x] Representative isolated seed, lint, suites, production build and connected
  live workflow checks completed. Coverage limitations remain explicit below.

## Behavior and implementation map

### Reporting, hierarchy and identity

`useReportScope.js`, `ReportScopePicker.jsx`, `reportPrefill.js` and the server
`reportScope.js` / `reportResults.js` / `reportExport.js` connect the reporting
pages. Empty group/assignment/period selections mean all available items;
selected groups include descendants. Quality and quantity have separate report
sections and export artifacts. Overviews count a student once across the scope.
Legacy sequence links resolve after period metadata loads; unavailable explicit
periods produce an alert and disable export instead of expanding the scope.

`TreePicker.jsx` provides compact summaries, expandable branches, full search
paths, branch-selection counts, selected-only filtering, and Done/Escape closing.
Groups and parameter lists also support collapse and search with parent context.
Assignment/session codes and individual student names disambiguate similar names.
Results search carries into Export; saved-view names use inline 60-character
inputs. Locked score changes use an inline 5–300-character audit reason.

`StudentIdentityInputs.jsx` exposes gender, birth date, father name and national
ID, including localized-digit normalization. These columns already existed but
remain optional for legacy records; the UI flags incomplete identity. Parameter
`parent_id` also existed but was absent from the parameter API. Teacher
`father_name` exists in neither the supplied schema-4 reference nor the inspected
schema, so no teacher field was added on that assumption.

`JalaliDatePicker.jsx` retains invalid typed Shamsi text, clears the committed ISO
value and blocks form submission until corrected. Stored/API dates remain ISO.

### Scheduling and tasks

`MultiAssignmentForm.jsx` and `routes/assignments.js` support all-or-nothing
multi-target creation. `SessionGenerator.jsx` and `lib/sessionPlan.js` preview
the exact plan, then recompute it under locks before accepting its token. Stale
or missing confirmation returns `SESSION_PLAN_STALE`. Controls support up to
200 sessions or 50 planned periods per assignment, with a 1,000-session total
plan limit. Distant starts and month-end recurrence preserve sequence/date rules.

One planned period means four generated sessions. Actual persisted periods form
only when active sessions have answers, four answered sessions per period; an
empty selected evaluation does not consume a slot.

`TaskTemplatesPage.jsx`, `TaskAssignment.jsx`, `TaskList.jsx` and
`EvaluationTasks.jsx` separate reusable definitions from assigned snapshots.
Editing a template does not rewrite existing task copies. Progress updates are
atomic, with per-item completion timestamps and optional notes. `scores.enter`
can read tasks/update progress; `schedule.manage` controls definitions,
assignment and deletion. The template-management route/navigation uses that
management permission.

Migration **036** enforces percentage quality, independent quantity ranges and
parameter hierarchy invariants. Existing numeric quality values are preserved;
the migration rejects out-of-range legacy values and performs no scale
conversion. The user-selected fresh representative seed avoids inventing a
conversion policy. Migration **037** adds checklist definitions/snapshots.

### 3D and loading

`DashboardPage.jsx`, `CohortHero.jsx`, `CohortConstellation.jsx` and
`lib/constellation.js` implement parameter choosing, six-orbit pages, thinner
bands and **0.2** radial spacing. `parameterIds: null` means all; `[]` means none;
explicit IDs persist. Filtering also changes overview calculations.

The 3D module preloads while report requests run. Scope controls mount when
opened, and the parameter chart bundle loads on first detail selection. A
camera-matrix/resize/visibility synchronization correction fixed the observed
blank canvas. Rendering is capped at 30 fps and pauses offscreen/when hidden;
ripples stop when automatic rotation is disabled. Offscreen pause/resume was
observed directly; real hidden-tab behavior and total CPU savings need further
measurement.

## Verification baseline

Evidence filenames below are relative to
[`audit/workflows-2026-10-30/`](../audit/workflows-2026-10-30/).

| Command/check | Result | Retained evidence |
| --- | --- | --- |
| Client `npm run lint` | Pass, including final loader correction | `client-lint-tests-build.txt`, `final-lint-build.txt` |
| Client `npm test -- --maxWorkers=2` | **246/246**, 32 files | `client-lint-tests-build.txt` |
| Client `npm run build` | Pass; final build 1,029 modules | `final-lint-build.txt` |
| Server `npm test` | **153 pass**, 6 gated integration skips | `server-unit-tests.txt` |
| Server `npm run test:core` | **57/57**, PGlite test mirror | `server-core-migrations.txt` |
| Server `npm run verify-pglite` | **37 migrations**, all reported sanity checks pass | `server-core-migrations.txt` |
| Server `npm run test-permissions`, isolated API/DB | **6/6** | `permissions-integration.txt` |
| Server `node src/scripts/workflowSmoke.mjs`, isolated API/DB | **11 checks**; Results/Export agree for **880** effective cells, both dimensions/previous values | `workflow-and-invariant-smokes.txt` |
| Server `npm run smoke:invariants`, isolated PostgreSQL | **5/5** real two-connection checks | `workflow-and-invariant-smokes.txt` |
| Agent `npm test` | **37/37** | `agent-tests.{json,txt}` |
| Live route sweep | **30 routes**, headings present, zero document overflow/error boundaries/alerts/console errors; Dashboard, Student Detail and login also checked | `live-checks.md` |
| Download checks | Scoped CSV, dual-dimension JSON/CSV/XLSX, SVG XML and 1120×840 PNGs pass | `artifact-verification.{json,txt}` |
| Two fresh-origin cold captures | Canvas observed at **3604.3 / 3746.4 ms**, zero 2D observations, no initial parameter-chart bundle | `cold-{a,b}-metrics.json`, `cold-{a,b}-trace.json.gz` |
| `git diff --check` and staged equivalent | Pass | Closing Git checks |
| `node audit/checks/stage2-reconcile.mjs` after implementation commit | **629** non-secret inventory files checked; **295** original evidence files byte-identical | `preservation.{json,txt}` |

These commands ran during this workstream. Core/migration/integration smokes
precede the last client refinements. The full client run includes the inline
override regression; the subsequent one-line unavailable-Export loader fix was
checked by lint, build and its live reproduction. It did not trigger another
full suite run. The 880 effective report cells are not the 573 stored seed rows:
effective reporting expands group values across applicable students.

To repeat the current workflow smoke, use the matching disposable API and set
`DATABASE_URL` and `TEST_SERVER_URL` explicitly; run from `server/`. Its API
portion creates durable probe data in that disposable database. The retained
read-only download check is `python3 audit/checks/workflow-artifacts.py`.

Historical `audit/checks/{browser-scoring-fixture,scoring-workflow,
scoring-report-consistency,score-import-preservation}.mjs` contain direct
`POST /api/sessions/generate` calls from the old protocol. Their historical
outputs remain valid evidence of those executions. A current caller first sends
`dryRun: true`, then sends the same plan with the returned `previewToken`.
The production UI and `workflowSmoke.mjs` use that protocol; those historical
scripts are not an unchanged current-version regression runner.

## Remaining measured issue and assurance limits

### [Medium] Cold 3D startup still takes approximately 3.6–3.75 seconds

**Where:** `client/src/pages/DashboardPage.jsx:19–32`,
`client/src/components/CohortHero.jsx:38–62`,
`client/src/components/CohortConstellation.jsx:247` onward.
**Confirmed by running:** two fresh-origin, authenticated production-build
captures at the same 1233×887 viewport. Canvas insertion was observed at
3604.3/3746.4 ms; this is a DOM-observation metric, not first painted WebGL output
or a Web Vital. Trace analysis reported 9/8 long tasks and 912.085/867.314 ms
long-task blocking. Event durations overlap and are not additive.

The two observers started at 931.5/860 ms and recorded zero subsequent 2D
observations. Earlier traces used different scopes/viewports/loading conditions,
so no reliable before/after speedup percentage is claimed. Further work should
profile the same scope and viewport, then reduce the measured initialization or
main-thread work before repeating that comparison.

- Switching Review tabs left `document.hidden === false`; a blank-tab animation
  wait timed out. Actual hidden-tab suspension was therefore **not verified**.
  Offscreen frame suspension and synthetic visibility-handler checks passed.
- Setting a 304 px canvas or 352 px Export container proved those component
  widths only. The harness did not resize the real viewport; **actual mobile or
  device layouts remain unverified**.
- XLSX ZIP/XML structure was checked; opening the files in Excel/LibreOffice was
  not. Real screen-reader announcements and cross-browser coverage were not run.
- Android/device, physical audio/model providers, full installer authentication,
  Windows and sustained-load/storage-exhaustion checks remain unexecuted.
- This workstream's workflow/invariant smokes do not constitute a new exhaustive
  cafe/accounting or authorization audit; earlier ledger evidence retains its
  original scope. PGlite is the test mirror, not the mobile runtime.

## Prior-audit reconciliation and preservation

[`docs/audit-notes.md`](audit-notes.md) is historical. Its existing disposition
link leads to `audit-2026-10-28-sp-gemini-1-opencode.md`; the later
[`audit/PRIOR_AUDIT_RECONCILIATION.md`](../audit/PRIOR_AUDIT_RECONCILIATION.md)
records why blanket closure was too broad, and
[`audit/FIX_LOG.md`](../audit/FIX_LOG.md) records Stage 2's **32 AUTO** dispositions
closed locally at `2338494`. This report extends that chain.

| Earlier finding/limit | Disposition in this workstream |
| --- | --- |
| Audit-notes #3/#8; A18/A19/A20 effective values, weighting and dimensions | Stage 2 fixes retained. New scoped Results/Export equality passed for 880 cells; Student Detail CSV and separate dimension filters passed. This does not settle every alternate aggregation/denominator policy. |
| Audit-notes #4; A14/A21 blind/individual score entry | Earlier fixes retained and automated coverage passes. The previous native-prompt verification blocker is removed: inline locked override saved/audited 57→58, then restored/audited 58→57 in the browser. |
| A31–A35 export artifacts/scope/labels | Current CSV/SVG, XLSX/SVG, JSON and JSON/PNG artifacts pass. Legacy sequence 1 resolves exactly; unavailable sequence 999 and zero-period scope disable export. The newly observed misleading loader was fixed and rechecked. |
| Hierarchy/3D UX and initial loading | New requested implementation verified by interactions/captures. Measured cold startup and mobile/hidden-tab limits remain as above. |
| A09, A12, A23, A24 | **Still deferred:** kiosk void confirmation, refund/ledger semantics, partial score-import contract and deployment grants. No closure is inferred from these workflow checks. |

Preservation at `1ab6179`: **493/629** inventory files match their original
hashes; **136** differ only in committed changes or the previously approved A06
local Android assertion patch. No missing/unexplained file changes; the inventory
itself and all **295** protected original evidence files are byte-identical.
Supplied handoffs remain untracked; all six supplied handoff/schema hashes also
match the Stage 2 closing receipt (`supplied-preservation.{json,txt}`). All three
`partly-schema/` files match the original inventory. Secret configuration was
excluded from the check. `captured-files.json` hashes **26** copied captures/logs;
command receipts and this live record are additional evidence.

The temporary workflow API was stopped after verification; port 3302 has no
listener (`stop-verification-api.{json,txt}`). The isolated fixture and disposable
clone remain available for review. All implementation/report commits stay local;
no push was performed.
