# Existing test quality — baseline a4d81f0

All 65 existing automated test files have been fully read. Ratings below judge
what each file actually proves, not its name or pass count. Java tests were
read but not run. The JS suites passed (server integration run separately).

- **USEFUL:** observable contract, boundary, or invariant assertion that can
  fail for a meaningful regression. This does not imply complete coverage.
- **WEAK:** some value, but limited or misleading assurance for its stated goal.
- **USELESS:** no application behavior exercised.
- **WRONG:** expectation contradicts the configured/shipped contract.

## Server unit/integration tests (`server/test/`)

Each name below is a `.test.js` file in this directory.

| File | Rating | What is established / gap |
|---|---|---|
| `alertsValidation` | USEFUL | Allowed statuses and strict boolean patch validation. |
| `audit` | USEFUL | Request classification, secret filtering and audit writer behavior; not DB durability. |
| `auditPrivacy` | USEFUL | Nested restricted-field stripping and input immutability; one composite fixture. |
| `auth` | USEFUL | Permission catalogue/prerequisite rules; the name does not mean login is tested. |
| `authMiddleware` | USEFUL | Fail-closed method/permission/password-change decisions; HTTP wiring is separate. |
| `cafeValidation` | USEFUL | Catalog price/name and supplier validation; misses valid three-decimal rejection in four flows (A13), manual refund direction (A12) and zero-total student sale (A11). |
| `csrf` | USEFUL | Token/origin/cookie behavior; misses non-ASCII equal-character/unequal-byte lengths (A04). |
| `evaluationCheck` | USEFUL | Shape, range, duplicate and target checks; inputs are supplied maps, not live memberships. |
| `exportCube` | USEFUL | Projection, selection and student expansion with known cells; not export HTTP/download. |
| `locks` | USEFUL | Boundary dates, changed-vs-unchanged locked cells and override reason validation. Equality handling is not tested as a blind-writer information leak (A14). |
| `money` | USEFUL | Exact bigint boundary and sum overflow refusal, including expected error code. |
| `periods` | USEFUL | Real-date validation and local day semantics; does not test persisted periods. |
| `permissions` | WEAK | Real HTTP denials help, but many allowed-route checks only rule out 401/403 and permit 500. Integration skipped by default; fixture cleanup assumes exclusive DB use. |
| `pgliteTypes` | USEFUL | Driver interval shape for scheduling; only two representative inputs. |
| `preferences` | USEFUL | Defaults, nested merge, independence and invalid preference rejection. |
| `results` | USEFUL | Both dimensions, targets, previous period and answered state in grid assembly. Group-row test checks only the group row, not inherited member cells (A18). No server-response/client-comment contract (A20). |
| `savedViews` | USEFUL | Configuration/name normalization, operators and limits; no ownership enforcement. |
| `scheduleValidation` | USEFUL | Interval bounds and exactly-one-target assignment validation. |
| `scorePreview` | USEFUL | Detailed before/after, selection-only, lock and blind-entry redaction assertions. |
| `studentImport` | USEFUL | Classification, duplicate/Unicode handling, dry-run flags and audit classification. |
| `studentValidation` | USEFUL | Name/date/identity bounds; not uniqueness or database persistence. |
| `taskValidation` | USEFUL | Required title, optional description, partial updates and maximum lengths. |
| `teacherValidation` | USEFUL | Required identity and partial updates with invalid-date cases. |
| `userRules` | USEFUL | Self-protection and last-manager decisions with supplied counts; misses A02 concurrency. |

## PGlite mirror (`server/src/core/services/`)

Each name below is a `.test.js` file. These tests use the real migration SQL
but call **mirror services**, not production Express routes. Fresh PGlite per
test isolates state and verifies SQL semantics; it does not establish
two-connection PostgreSQL locking, session security, or route authorization.

| File | Rating | What is established / gap |
|---|---|---|
| `audit` | USEFUL | Persisted audit rows, pagination, filtering and actor attribution. |
| `auth` | WEAK | Correct for the intentionally all-powerful test stub; cannot establish production authentication. |
| `evaluations` | USEFUL | Save/read/no-op/delete, dry-run nonmutation, historical membership, locked changes and audit snapshots. Admin-only context omits blind-entry HTTP authorization. |
| `fields` | USEFUL | Field type/choice persistence, duplicate labels, archive and audit behavior. |
| `groups` | USEFUL | Membership, archive, hierarchy and audit behavior; concurrency requires real PG. |
| `parameters` | USEFUL | Validation, list/archive behavior and stored-value range guard. |
| `periods` | USEFUL | Four answered sessions per bucket, empty-cell exclusion, detach/archive/restore lifecycle. |
| `preferences` | USEFUL | Stored partial merge and reset; only one local user. |
| `results` | USEFUL | Real score-to-grid/trends/summary path and historical roster shadowing. The final “scoping” assertion passes `assignmentId: undefined`, so that assertion is WEAK for assignment filtering. |
| `savedViews` | USEFUL | Persisted normalized config, name uniqueness and delete; local admin does not test ownership isolation. |
| `students` | USEFUL | CRUD/search/pagination/extra fields and import dry-run/save/audit through mirror services. |

Specific weak cases: `auth.test.js:71-74` just checks the unconditional stub;
`evaluations.test.js:387-390` checks preview container types without expected
cell contents (the pure preview suite is stronger);
`results.test.js:343-345` does not actually apply the claimed assignment filter.
`evaluations.test.js:241` supplies a redundant third argument to the query
adapter; the passing PGlite test does not validate node-postgres's overload.

## Client (`client/src/`)

| File | Rating | What is established / gap |
|---|---|---|
| `components/StudentFieldInputs.test.jsx` | USEFUL | Real rendered inputs, restricted badge and change callbacks; only shared form component coverage. |
| `i18n/errors.test.js` | USEFUL | Error-code translation, interpolation, entity translation and fallback. |
| `i18n/parity.test.js` | USEFUL | Locale key-tree and error catalogue parity; not translation accuracy or layout. |
| `lib/audit.test.js` | USEFUL | Audit category and finance action detail presentation. |
| `lib/bundle.test.js` | USEFUL | ZIP is decompressed and byte contents checked, including binary data. |
| `lib/cells.test.js` | USEFUL | Numeric input, access/lock decisions, dirty drafts and save payload construction. Missing localized-digit cases allow A25 despite the Persian-default UI. |
| `lib/constellation.test.js` | USEFUL | Geometry finiteness/spread and state appearance; not WebGL rendering. |
| `lib/csv.test.js` | USEFUL | Quoting, separator/BOM and formula guarding; does not open exports in spreadsheet software. |
| `lib/cube.test.js` | USEFUL | Known per-student/per-period aggregation and dimensions. |
| `lib/dashboard.test.js` | USEFUL | Summary/distribution/trend/roster aggregation and default-period choice. Its comment fixtures have properties the real results API omits, hiding A20. Explicit cross-product expectation conflicts with selected-cell documentation; denominator policy needs clarification. |
| `lib/exportConfig.test.js` | USEFUL | Config normalization, prefill and invalid export combinations. |
| `lib/exports.test.js` | USEFUL | Long/wide/delta/audit/JSON data output from known cube; no download UI. |
| `lib/format.test.js` | USEFUL | Code/date/range/change presentation; English and dual-calendar fixtures. |
| `lib/heatmap.test.js` | USEFUL | Known matrix cells, domains and missing values. |
| `lib/importNames.test.js` | USEFUL | Header/column inference, row numbers and name composition. |
| `lib/locale.test.js` | USEFUL | Digit conversions, Gregorian/Jalali conversion and invalid dates. |
| `lib/money.test.js` | USEFUL | Persian digits, quantity/whole-number input and formatting. |
| `lib/numbers.test.js` | USEFUL | Blank/finite/junk parsing and zero handling; sparse boundary coverage. |
| `lib/pageTransition.test.js` | USEFUL | Motion descriptors, geometry/direction and timing budgets; DOM lifecycle/focus is untested. |
| `lib/resultsView.test.js` | USEFUL | Filters, sorting, dimensions, config equality and deltas on a known grid. |
| `lib/scoreImport.test.js` | USEFUL | Layout inference, parsing, plan construction and override reason checks. |
| `lib/studentFields.test.js` | USEFUL | Typed custom-value mapping/clearing and minimal patch construction. |
| `lib/theme.test.js` | USEFUL | Supported/default theme contract; no applied-theme DOM behavior. |
| `lib/views.test.js` | USEFUL | Persisted periodSeq membership despite overlapping dates and detached sessions. |
| `lib/xlsx.test.js` | WEAK | Typed cell/sheet descriptors and formula protection; no generated XLSX round trip or file validity check. |

## Agent (`agent/test/`)

| File | Rating | What is established / gap |
|---|---|---|
| `dialogue.test.js` | USEFUL | Literal confirmation, stages 2/3/4, reset after cart change and basic model refusal. Adapter is mocked: no HTTP, provider, asynchronous race or receipt-contract proof. |
| `faWords.test.js` | USEFUL | Several exact number renderings. The case claiming “whole money range” is WEAK: it tests one maximum and only matches the billion word. |
| `intents.test.js` | USEFUL | Bilingual quantities, names, literal yes/no and longest-name match. No negated-void utterance or model-driven void coverage. |

`dialogue.test.js:206-220` attempts an LLM `record_sale` against an **empty cart**;
it cannot independently prove the confirmation gate is what prevented a write.
The test should first prepare a nonempty unconfirmed cart. The stage-4 void
case only asserts any void call, despite claiming the exact last-sale scope.

## Android (`client/android/app/src/`)

| File | Rating | Reason |
|---|---|---|
| `test/java/com/getcapacitor/myapp/ExampleUnitTest.java` | USELESS | Only `2 + 2 == 4`, no application code. |
| `androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java` | WRONG | Expects `com.getcapacitor.app`; configured application ID is `app.studentpanel.mobile`. |

## Existing operational checks

| Script | Rating | Limitation |
|---|---|---|
| `server/src/db/verifyPglite.mjs` | USEFUL | Broad fresh-schema/invariant checks. Individual arbitrary-error `expectReject` assertions are WEAK unless expected code/constraint checked. |
| `server/src/scripts/invariantRaceSmoke.mjs` | USEFUL | Actual two-connection hierarchy/range/parameter races and expected SQLSTATE; not a universal concurrency proof. |
| `server/src/scripts/alertsSmoke.mjs` | USEFUL | Lifecycle/idempotency over real SQL in rollback. |
| `server/src/scripts/cafeStockSmoke.mjs` | USEFUL | Exact quantity/average-cost ledger invariants in rollback. |
| `server/src/scripts/cafeSalesSmoke.mjs` | USEFUL | Sale/void/refund/stock/report invariants in rollback. |
| `server/src/scripts/accountingSmoke.mjs` | USEFUL | Journal/period/report identities with concrete numbers; assumes no concurrent unrelated financial writes. |
| `agent/scripts/liveSmoke.mjs` | USEFUL | Real adapter/API sale/void permissions; destructive fixture cleanup requires isolated DB. |
| `agent/scripts/apiSmoke.mjs` | WEAK | Rejects unexpected HTTP failures but dynamic fixture branches can silently skip; an `expectFail` route succeeding does not fail the check. Does not assert response schemas. |

## Supplemental audit probes

These scripts live under `audit/checks/`, separately from the 65 existing test
files. They do not retroactively improve the ratings of the existing suites.

| Probe | Executed assurance / limitation |
|---|---|
| `scoring-workflow.mjs` | Seven passing real HTTP/SQL groups cover import, preview/save/no-op/atomicity, period allocation, cube expansion/shadowing, blind preview and lock/override. Score import uses an import-tagged API payload, not the browser CSV parser. `oracle` mode fails on A14 with unchanged score/timestamp/audit controls. |
| `role-user-manager-race.mjs` | Deterministic PostgreSQL audit barrier makes both real routes pass their independent manager checks; verifies lost manager capabilities and restores the original users. Fails on A02. |
| `manual-refund-direction.mjs` | Known top-up/refund amounts correlate with both balance history and posted deposit-account lines, exposing A12. Financial cleanup retains append-only history. |
| `three-decimal-quantity.mjs` | Four actual parser/HTTP paths reject valid quantities; four-decimal negative controls prevent treating permissive parsing as a fix (A13). |
| `backup-restore-roundtrip.mjs` | Actual scripts restore 40 table fingerprints in a separate DB, reject bad gzip and preserve rollback marker. Marker is checked after a second failing control invocation; assertions immediately after each project invocation would be clearer. Does not establish recovery under storage exhaustion or interruption. |
| `workbook-generation.mjs` + `validate-workbook.py` | Actual writer and independent ZIP/XML validator pass known typed/Unicode/formula/blank cells. Validator also checks the actual UI download against preview values. No spreadsheet-application interoperability test. |
| `agent-missing-mic-fallback.mjs` | Real byte-identical entrypoint copied under `audit/.tmp/`, fake local API, empty PATH. Fails because announced fallback never starts readline or consumes EOF (A16). No physical audio or financial writes. EOF is sent immediately, so the product-request count is observational rather than a required completed-turn assertion. |
| `agent-provider-deadlines.mjs` | Five real local held HTTP requests have no abort signal and remain pending for 1500 ms; 503 release demonstrates rule fallback. This is a bounded resilience observation, not proof of indefinite hanging or an agreed timeout violation. |
| `scoring-report-consistency.mjs` | Real HTTP fixture with independent known [8,2,2] effective scores exposes results inheritance (A18) and trend weighting (A19). Feeds actual results JSON into real dashboard helpers to expose A20 with blank/opposite-comment controls. Denominator discrepancy is logged as a policy observation, not asserted as a decided contract. Synthetic scores removed and entities archived. |
| `scoring-components.test.jsx` | 1 pass / 3 failures: real page/Query/grid/PapaParse plus actual server preview builder expose A21 individual/blind loading and A22 object-child crash. Required-query settlement is asserted before checking inputs; sighted-group typing control passes. APIs are mocked, so blind browser HTTP and successful submission remain separate verification. |
| `score-import-preservation.mjs` | Corrected run `-04` exercises real CSV helpers and live preview/save/readback: blank-pair control passes; partial values and omitted comments are erased (A23). Bypasses A22's React renderer. Three retained earlier harness failures are documented in `continuation-04/import-preservation.md`, not counted as product failures. |
| `deployment-ledger-grants.mjs` | Actual deployment-template ACLs under a non-owner/non-superuser role permit audit UPDATE/DELETE and stock TRUNCATE (A24); stock DELETE is a passing negative control. Rollback fingerprints, ACL restoration and temporary-role absence are asserted. No HTTP exploit or deployed installation tested. |
| `browser-scoring-fixture.mjs` + browser observations | Durable synthetic setup supports an actual 7/6/comment save with captured HTTP 200 and independent readback; blind login reproduces A21 after required requests settle. Score/results/export 403 controls pass. Native override prompt is unsupported by this browser host; Discard restores saved values. Cleanup is checked independently by `verify-browser-fixture-cleanup.mjs`. |
| `localized-score-digits.test.mjs` | 2 pass / 4 fail: real parser, payload and no-op helpers reject Persian/Arabic-Indic digits (A25). Passing ASCII/blank/zero and invalid-syntax/range controls constrain the repair. Browser evidence independently demonstrates disabled Save and the ASCII success control. |
| `pos-rounding.test.jsx` | 1 pass / 2 fail: actual POS page, parsers and Query state display 14 instead of 15 for 0.145 × 100, and 2 instead of aggregate 1 for two 0.005 × 100 lines (A26). Fixed arithmetic expectations avoid mirroring the defective rounding. APIs are mocked; the single-line browser/API/ledger reproduction independently corroborates the mismatch. |
| `browser-finance-fixture.mjs` + browser observations | Actual purchase, student sale/overdraft and confirmed void; captured responses plus independent stock/balance/journal readbacks. Pointer host errors required DOM control activation, so this does not prove pointer hit-testing. Cleanup retains history; `verify-browser-finance.mjs` independently asserts the ledger cycle and inactive synthetic entities. |
| `browser-group-fixture.mjs` + browser observations | Actual Add/Remove/Re-add/Remove, four HTTP 200s and independent total/open membership counts 1/1 → 1/0 → 2/1 → 2/0. Two historical IDs retained; synthetic entities archived. Pointer hit-testing is unverified. |
| `accounting-cache.test.jsx` | 4 failures (A27): actual POS sale/void and accounting journal/report consumers retain old displays on remount under the application's 30-second freshness settings. Every explicit-refresh control passes. I/O is mocked; no live database or native route-navigation claim. |
| `setup-target.test.mjs` | Corrected `setup-target-02`: 1 pass / 1 failure (A28). Byte-identical installer with fake CLI dispatch executes the sudo wrong-target branch and a passing explicit-network fallback. No real cluster writes. Original run's diagnostic-count assertion was a harness error and remains retained. |
| `browser-journal-fixture.mjs` + browser observations | Actual Persian draft/post/void, HTTP 201/200/200, unbalanced-input negative control, unchanged line IDs/amounts and independent report +321/restoration assertions. Voiding was user-confirmed; failed keyboard activation is inconclusive. History retained and fixture settled. |
| `privacy-auth-matrix.mjs` | Corrected `-02`: 25 pass / 3 fail, exposing A07 across detail/list/PATCH with active/restored controls. Actual audit row/admin-marker presence precedes redaction assertions. Real multi-session password/reset/deactivation and reduced-role access checks pass, with SELECT cleanup. Original `details.body` probe-envelope mistake is retained, not a product finding. |
| `role-catalog.test.jsx` | 1 pass / 2 fail: real page/Query/error boundary, mocked I/O; settled initial catalog failure followed by New/Edit activation crashes (A29). Successful catalog/selected-permission control passes. No live request failure or browser pointer test is claimed. |
| `schedule-calendar.test.jsx` + `schedule-calendar-sql.mjs` | Component: 3 pass / 2 fail (A30), using fixed month-end/leap dates and actual SchedulePage. PostgreSQL SELECT-only control confirms all five anchored recurrence expectations. No generated-session write, live browser clock change or DST coverage. |
| `export-ui.test.jsx` | Corrected `export-ui-02`: 3 pass / 6 fail across actual page/adapter, chart controls, Recharts and SVG capture. Failing selected-period score rows, three legend-only captures, ignored heatmap period and empty default distribution establish A32–A34. All-calendar, heatmap-capture and explicit-distribution controls pass. Only layout APIs and I/O are mocked. Initial translation-punctuation and jsdom duplicate-xmlns probe failures are excluded; Chromium bytes establish real SVG validity separately. |
| `export-ui.test.jsx` label subset | `export-labels`: 2 fail / 9 intentionally skipped. Both languages expose raw translation keys in trend/comparison and identical UUID-prefix heatmap headings (A35), supplementing actual Persian browser observations. |
| `export-period-control.mjs` + retained browser artifacts | Corrected `-02` verifies real API filters 210 cells to period 1 before failing the browser CSV's extra-period rows (A33). Initial metadata-scope assumption is preserved, not misreported as a passed control. Actual downloaded CSV/SVG bytes and production PNG CSP refusal are retained in continuation-09. Data-URL canvas control succeeds under unchanged CSP (A31). |
| `scheduling-errors.test.jsx` | Corrected `scheduling-errors-03`: 4 fail / 2 pass, English and Persian. Actual SessionsPage quick Cancel and SchedulePage Restore suppress route refusals; Edit cancellation displays the same translated error (positive controls). HTTP I/O alone is mocked; real browser 409/400 requests independently establish refusals. Initial ambiguous-checkbox, early-render and incorrect mocked error-shape control failures are retained and excluded. |
| `menu-focus.browser.js` | Native Chromium Code Mode regression, 4 fail / 2 pass at 480×597 Persian/RTL. Opening, forward containment and both boundary wraps fail; Escape and closed-sidebar inertness pass. DOM focus only sets boundary starts; keys and focus/layout behavior are native. Extends A15, not a new finding. Requires the isolated signed-in `/schedule` page and a narrow viewport; no desktop assurance. |

## High-value missing assurance

Permanent regressions for the audit reproductions; nonempty-cart model gate;
spreadsheet-application interoperability; blocked successful browser workflows,
desktop and Android integration. Source review is complete within `COVERAGE.md`'s
scope. Real provider/device and sustained-load assurance remain unavailable.
None of these gaps is filled merely by a passing aggregate test count.
