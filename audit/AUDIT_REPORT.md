# Local audit — Stage 1 report

**Status: STAGE 1 COMPLETE within the documented local scope; Stage 2 begins.**
Authored source review and feasible critical workflows are complete. Known
product blockers and environmental limits remain explicit in `COVERAGE.md`.
The 36 findings below describe the unchanged baseline, not an all-clear;
remediation progress belongs in `FIX_LOG.md`.

- Repository: local `sp-gemini-1`; baseline commit
  `a4d81f07d2e016341310dc8df79b9c878cf32ada`, branch `main`.
- Evidence captured 2026-10-29 UTC; Stage 1 closed 2026-10-30 local time.
  Local files are authoritative. No upstream operations.
- Initial untracked user work: `partly-schema/`, preserved.
- Isolated PostgreSQL: `127.0.0.1:55439/student_panel_audit`; API/SPA:
  `127.0.0.1:3300`, production mode, Origin checks enabled. Port 3000 is unrelated.
- All 35 migrations applied. Initial seed: 30 students, 6 parameters, 5 assignments,
  71 sessions, 13 answered periods, 573 evaluation cells; connected cafe fixtures.
  These are initial counts; synthetic archived fixtures and append-only evidence remain.
- Database MCP was initially unavailable. It became available on resumption but
  targets `127.0.0.1:5432/sp_gemini_1_audit`, not the isolated test database;
  isolated schema inspection and mutations use the pinned local connection.
- Stage 1 made no application source changes, dependency upgrades, or schema changes.

## Verification baseline

Outputs and command/exit metadata are retained under `audit/baseline/`.

| Check | Observed result | Evidence stem |
|---|---|---|
| Client lint | PASS | `lint` |
| Client production build | PASS | `build` |
| Client tests | 25 files, 214 passing tests | `tests-client` |
| Server unit suite | 135 pass; 6 integration skips | `tests-server` |
| Isolated HTTP integration suite | 6 pass; assertion limitations below | `tests-permissions` |
| Agent unit suite | 21 pass | `tests-agent` |
| Core PGlite suite | 55 pass | `tests-core` |
| PGlite migration verifier | 35 migrations + invariants pass | `verify-pglite` |
| Real PostgreSQL migrations | 35 applied | `migrate` |
| Stock smoke | 6 checks pass | `smoke-cafe-stock` |
| Cafe sale/report smoke | 8 + 5 checks pass | `smoke-cafe-sales` |
| Alert smoke | 6 checks pass | `smoke-alerts` |
| Real invariant races | 5 checks pass | `smoke-invariants` |
| Accounting smoke, serial | 9 checks pass | `smoke-accounting-serial` |
| Browser login + 30 protected routes | Narrow Persian/RTL route rendering observed | `browser-routes.md` |

`smoke-accounting.txt` is a **harness interference failure**: a concurrent kiosk
probe added a 12000 sale between aggregate reads (`241000 !== 229000`). The
serial rerun after cleanup passed. Shared-database mutation checks must run
serially. This is not evidence of an accounting product defect.

### Continuation executions

Output and exit metadata are in `audit/continuation-01/`; original baselines
are retained. Failing defect checks below assert the intended contract.

| Check | Observed result | Evidence stem |
|---|---|---|
| Manual top-up/refund and correlated journal | FAIL: balance 1400, deposit liability 600 (A12) | `manual-refund-direction` |
| Three-decimal purchase/sale/waste/adjustment | FAIL: all four reject valid ±1.005; four-decimal controls reject (A13) | `three-decimal-quantity` |
| Actual backup/restore scripts, disposable database | PASS: all 40 source table fingerprints match; invalid gzip refused; SQL failure leaves original marker | `backup-restore-roundtrip` |
| Cross-route role/user manager race | FAIL: both HTTP 200; no active holder for either management permission (A02) | `role-user-manager-race` |
| Real scoring/import/export workflow | PASS: seven assertion groups, described below | `scoring-workflow` |
| Blind-entry locked-score equality oracle | FAIL: recovered score 8 with ten requests; no score/timestamp/audit mutation (A14) | `blind-locked-score-oracle` |

The scoring workflow covers student import preview/classification/commit/repeat,
session-generation idempotence, preview nonmutation, selected-empty period
exclusion, no-op timestamps/audit, invalid-batch atomicity, import-tagged score
save, 4+1 answered-session allocation, GET/POST export-cube agreement, individual
score shadowing of group values, blind preview redaction, lock refusal and
reasoned override. These are HTTP/SQL assertions, not browser submissions.

Backup/restore used a new disposable database on port 55439 and left the working
evidence database dump-only. The unchanged scripts succeeded with psql 16.15;
a documentation-based concern about stdin/`--single-transaction` did not reproduce.
The rollback marker was read after both project and control failing invocations;
the control cannot undo a prior committed project update. More direct per-step
assertions would make this probe clearer.

### Earlier full-check rerun (continuation 06)

All seven launched checks completed successfully; their output/exit metadata is
retained in `continuation-06/`. Client lint passed; client tests passed **25 files /
214 tests**; server unit tests passed **135** with **6 integration skips**; agent
tests passed **21**; core tests passed **55**; PGlite applied **35 migrations** and
passed its sanity checks; the production build passed. The audit-local Vite
wrapper preserves the project configuration while directing cache/build output
under `audit/.tmp/`. HTTP integration and live smokes have not been rerun in this
continuation; the earlier isolated passes above remain historical evidence.

### Stage 1 final verification

All **13 commands** under `stage1-final/` exited **0**, with outputs and command
metadata retained. Lint and production build pass; client **25 files / 214 tests**,
server **135 pass / 6 integration skips**, agent **21**, core **55**, and PGlite
**35 migrations plus sanity checks** pass. The separately executed HTTP integration
suite passes **6/6**. Serial real-PostgreSQL smokes pass: stock **6**, sale/report
**8+5**, alerts **6**, invariant races **5**, accounting **9**.

`checks/run-isolated-suites.mjs` pins DB/API isolation and serial execution; browser
mutations were paused during it. These are project-suite results, not passing
audit regressions. Original failing evidence remains intact. The source-coverage
reconciliation also exits 0. Android execution remains unavailable: `javac`,
`adb`, and `emulator` are absent from PATH and both Android SDK variables are unset.

## Verified findings (ordered by severity)

### A01 — HIGH — Backup retention can delete an unrelated file

- **Status:** VERIFIED by running `node audit/checks/backup-spaces.mjs`.
- **Where:** `deploy/backup.sh`, retention pipeline at the end of the script.
- **Evidence:** `baseline/backup-spaces.{txt,json}`. With a backup directory
  containing spaces and `KEEP=1`, command exits 0, removes a separate sentinel,
  retains the expired dump, and leaves 2 dumps.
- **Mechanism:** whitespace-delimited filename processing splits a full path
  before deletion.
- **Impact:** data loss outside the intended backup set and failed retention.
- **Smallest fix:** preserve filename boundaries throughout ordering/pruning;
  retain existing retention semantics and validate the fixture with spaces.
- **Effort/disposition:** small / AUTO (implementation hardening).

### A02 — HIGH — Concurrent role edits can remove every active manager

- **Status:** VERIFIED by real HTTP requests plus real PostgreSQL locks.
- **Where:** `server/src/routes/roles.js` PATCH permission-removal transaction;
  `server/src/routes/users.js` PATCH guarded-permission transaction.
- **Evidence:** `checks/role-manager-race.mjs`,
  `baseline/role-manager-race.{txt,json}`. Both requests returned 200; both
  guarded permission holder counts fell from 2 to zero. Fixture roles restored.
  `checks/role-user-manager-race.mjs` and
  `continuation-01/role-user-manager-race.{txt,json}` additionally establish the
  cross-route case: concurrent role-permission removal and user deactivation
  both return 200 and remove both manager capabilities. Original users restored.
- **Mechanism:** separate role row locks do not serialize the cross-role
  invariant. Each transaction sees the other role's still-committed permissions.
- **Impact:** all application-based user/role administration can be lost.
- **Smallest fix:** a shared transaction-scoped invariant lock acquired in a
  consistent order by all role/user mutation paths before invariant reads.
  No new schema is necessary. Verify role/role and role/user interleavings.
- **Effort/disposition:** medium / AUTO; role/role and role/user races reproduced.

### A03 — HIGH — Concurrent kiosk confirmations submit the same cart twice

- **Status:** VERIFIED with real Dialogue/tool handlers and a delayed adapter.
  Duplicate real financial writes have not been performed for this probe.
- **Where:** `agent/src/dialogue.js:240-280`,
  `agent/src/tools.js:204-224`.
- **Evidence:** `checks/concurrent-confirm.mjs`,
  `baseline/concurrent-confirm.{txt,json}`; 2 sale requests for 1 confirmed cart.
- **Mechanism:** phase/gate remain eligible while the first sale awaits I/O.
- **Impact:** repeated confirmation can double-charge and double-decrement stock.
- **Smallest fix:** single-flight sale state set synchronously before awaiting;
  confirmation must refer to an immutable cart snapshot. Exercise concurrent
  speech/screen calls and cart changes during I/O.
- **Effort/disposition:** medium / AUTO for duplicate submission; protocol/API
  redesign or cross-process idempotency requires ASK.

### A07 — HIGH — Archiving a restricted field exposes its stored values

- **Status:** VERIFIED by running the real API reproduction
  `checks/archived-field-privacy.mjs`.
- **Where:** `server/src/routes/students.js:25-34` (`loadDefinitions`),
  `server/src/lib/fields.js` (`stripRestricted`).
- **Evidence:** `baseline/archived-field-privacy.{txt,json}`. A viewer without
  `fields.view_restricted` cannot see the active synthetic value, but can read
  it in both student detail and list immediately after its definition is archived.
- **Mechanism:** the response filter receives only active definitions, so the
  archived restricted ID is no longer on its deny list while its value remains.
- **Impact:** restricted student data becomes accessible to ordinary viewers.
- **Smallest fix:** include archived definitions for response privacy while
  retaining active-only validation; cover read and mutation response paths.
- **Effort/disposition:** small / AUTO. Synthetic fixture was soft-deleted.

  Extended real matrix `continuation-08/privacy-auth-matrix-02.{txt,json}` confirms
  the same leak in **PATCH responses**, alongside detail/list. Active and restored
  definition controls pass; public values remain visible and unauthorized writes
  cannot alter the stored private value. Audit-route redaction passes in all three
  phases with positive persisted-entry controls. See `continuation-08/privacy-auth.md`.

### A09 — HIGH — Undo bypasses the staged financial confirmation boundary

- **Status:** VERIFIED with real Dialogue/tool handlers and a spy adapter;
  this probe did not perform real financial writes.
- **Where:** `agent/src/dialogue.js:189-190`,
  `agent/src/tools.js:227` (`void_last_sale`), `agent/src/intents.js` void match.
- **Evidence:** `checks/void-stage-gate.mjs`,
  `baseline/void-stage-gate.{txt,json}`: stage-2 `undo`, stage-3 `do not undo`,
  and an LLM tool call on `hello` each invoke the void adapter once.
- **Mechanism:** the sale gate does not cover the void handler, and the void
  intent matches a keyword inside a negated phrase.
- **Impact:** unintended reversal of the last sale, stock and balance effects.
- **Smallest fix:** agree and enforce a literal void-confirmation protocol at
  the supervisor/tool boundary; reject negated commands and direct model voids.
- **Effort/disposition:** medium / ASK — the architecture treats confirmation
  protocol changes as product decisions. Continue other fixes without blocking.

### A12 — HIGH — Manual cash refund increases the student's prepaid balance

- **Status:** VERIFIED through real HTTP writes and correlated posted journal lines.
- **Where:** `server/src/routes/cafeBalances.js:131-137`,
  `server/src/lib/cafeBalance.js:18-47`; live constraint
  `cafe_balance_refund_positive` requires positive refund ledger amounts.
- **Evidence:** `checks/manual-refund-direction.mjs`,
  `continuation-01/manual-refund-direction.{txt,json}`: top-up 1000 followed by
  cash refund 400 leaves **1400**, although the active refund mapping correctly
  debits deposits/credits cash and leaves a **600** deposit liability.
- **Mechanism:** a positive cash-refund amount is passed as a positive balance
  delta. The same ledger kind also represents a positive sale-void reimbursement,
  which has a different business direction.
- **Impact:** a cash refund grants additional spendable credit and makes the
  balance ledger disagree with accounting by twice the refund amount.
- **Smallest fix:** distinguish outbound cash refunds from sale-void credits,
  with an approved signed-ledger/schema convention and historical reconciliation
  policy. Merely negating the route amount violates the current DB constraint.
- **Effort/disposition:** medium / ASK — schema/ledger semantics and historical
  financial remediation require a decision. Synthetic journals were voided,
  balance settled by adjustment, student archived; append-only evidence retained.

### A14 — HIGH — Blind score writers can recover locked scores without changing them

- **Status:** VERIFIED through the real authenticated bulk-save endpoint.
- **Where:** `server/src/lib/locks.js:39-50`,
  `server/src/routes/evaluations.js:356-390,518`.
- **Evidence:** `checks/scoring-workflow.mjs oracle`,
  `continuation-01/blind-locked-score-oracle.{txt,json}`. A user with `scores.enter`
  but neither `scores.view` nor `scores.override` receives 403 for score/export
  reads. Ten candidate writes to a locked score return 409/`LOCKED` except the
  exact score **8**, which returns 200/`changed:0`. Before/after score rows,
  timestamps and score audit rows are identical.
- **Mechanism:** equality bypasses the change lock and produces a distinguishable
  success. Preview redaction cannot hide this write-response equality signal.
- **Impact:** blind-entry confidentiality is defeated for enumerable scores,
  without modifying the protected data or generating a score-save audit.
- **Smallest fix:** enforce a value-independent locked-cell response for blind
  writers before equality handling, retaining sighted no-op behavior. Cover
  correct/incorrect guesses and preview without revealing prior values.
- **Effort/disposition:** medium / AUTO for the narrow permission-boundary fix;
  broader blind-entry/API redesign remains ASK. Fixture role restored and
  synthetic scores removed through authorized overrides.

### A18 — HIGH — Whole-group scores disappear from members' results and dashboard

- **Status:** VERIFIED with real API saves/reads and the actual dashboard helpers.
- **Where:** `server/src/lib/results.js:32-47,79-99`,
  `server/src/routes/results.js:110-145`; consumed by
  `client/src/pages/DashboardPage.jsx:73-103`.
- **Evidence:** `checks/scoring-report-consistency.mjs`,
  `continuation-03/scoring-report-consistency.{txt,json}`. Three members, one
  session, group score 2 and one individual override 8: export correctly returns
  **[8,2,2]**, results returns **[8,missing,missing]**, and dashboard reports
  **33%** completion with average **8**, instead of all three effective scores.
- **Mechanism:** results keys group and member evaluations separately and never
  expands group cells onto eligible members. Client roll-ups exclude the group
  row, so the remaining members' valid group scores disappear.
- **Impact:** student results, completeness and statistics disagree with saved
  effective scores and export. This reproduces part of historical audit-notes #3.
- **Smallest fix:** apply historical membership eligibility and own-cell
  shadowing per session before existing period aggregation, including previous
  values. Preserve a member's selected-empty shadow and individual assignments.
  Merely copying the period-wide group row could leak scores across membership dates.
- **Effort/disposition:** medium / AUTO for documented group fallback; changing
  the cross-session aggregation policy remains ASK. Synthetic cells removed and
  entities archived after the check.

### A21 — HIGH — Individual and blind-entry scoring grids never become usable

- **Status:** VERIFIED in the real browser and component execution for both
  individual and blind entry, with passing sighted-group controls.
- **Where:** `client/src/pages/EvaluatePage.jsx:93-106,348,467`.
- **Evidence:** `continuation-04/browser-scoring.md`,
  `continuation-04/scoring-components.{txt,json}` and
  `checks/scoring-components.test.jsx`. Real individual selection has 10 sessions,
  settled HTTP 200 responses and zero grid rows; group control has 16 rows.
  Component queries settle with no fetches but the irrelevant disabled query
  stays pending/idle, and both individual and blind cases cannot find inputs.
  `continuation-05/browser-scoring.md` adds real blind-role login: required
  requests settled, two session options populated, but zero grid rows/inputs
  and a persistent loader. Explicit score/results/export reads returned 403.
- **Mechanism:** unconditional loading gate includes `membersQuery.isPending`
  even when no group exists, and `savedQuery.isPending` when score reads are forbidden.
- **Impact:** supported individual-assignment and blind-entry scoring are blocked.
- **Smallest fix:** gate only required/enabled data dependencies; retain real
  initial loading and errors, and verify both modes plus the sighted-group control.
- **Effort/disposition:** small / AUTO for the existing permission/assignment contract.

### A22 — HIGH — Checking a valid score CSV crashes the entire interface

- **Status:** VERIFIED by real browser file upload/Check file and component execution.
- **Where:** `client/src/pages/ImportScoresPage.jsx:51-117`, compared with
  `server/src/lib/scorePreview.js:24-31,67-74`.
- **Evidence:** `continuation-04/browser-scoring.md`, retained `score-preview.csv`,
  `continuation-04/scoring-components.{txt,json}`. Dry-run HTTP 200 returns a new
  cell with quality 77/quantity 66; React error #31 immediately renders the
  application error boundary. Evaluation rows remain empty before/after preview.
- **Mechanism:** preview rendering inserts whole-cell `from`/`to` objects into
  scalar JSX children instead of choosing the column's quality/quantity value.
- **Impact:** valid score-import preview and subsequent confirmation are unusable.
- **Smallest fix:** select each dimension's scalar preview fields while retaining
  lock/blind redaction and zero/blank semantics; cover new/change/unchanged cases.
- **Effort/disposition:** small / AUTO; no server API redesign is required.

### A23 — HIGH — Partial score imports erase blank/unmapped dimensions and comments

- **Status:** VERIFIED with real CSV parser/planner and real HTTP preview/save/readback;
  React preview renderer bypassed because A22 prevents browser confirmation.
- **Where:** `client/src/lib/scoreImport.js:169-178`,
  `client/src/pages/ImportScoresPage.jsx:381-416`,
  `server/src/routes/evaluations.js:399-444`. Contradictory UI promise:
  `client/src/i18n/{en,fa}/students.json:213`.
- **Evidence:** `checks/score-import-preservation.mjs`,
  `continuation-04/score-import-preservation-04.{txt,json}` and
  `continuation-04/import-preservation.md`. Quality 11/quantity 22 becomes
  77/null when importing only quality 77, including when quantity is explicitly
  blank. Quantity-only import clears quality. All four nonempty cases also clear
  both existing comments. Entirely blank pair is a passing nonmutation control.
- **Mechanism:** parser supplies null for blank/unmapped dimensions and omits
  comments; the full-cell API replaces every dimension/comment. Import source is
  only an audit label, so it provides no preservation semantics.
- **Impact:** existing scores and notes are lost contrary to the advertised
  blank-preservation behavior; A22 currently blocks the normal UI before commit.
- **Smallest correct fix:** agree an explicit partial-import contract, retain an
  update mask, and merge under the existing transaction/lock boundary for both
  preview and save. Preserve blind-entry redaction; fetching hidden values or
  replaying a stale client snapshot is not a sound general repair.
- **Effort/disposition:** medium / ASK — the server currently requires both value
  fields and treats omission as replacement. API/import and comment policy need
  approval; changing the blank-value promise alone would not repair the loss.
  Synthetic scores removed and entities archived; initial harness failures are
  retained and explicitly excluded from product evidence.

### A08 — MEDIUM — One malformed Host header terminates the kiosk

- **Status:** VERIFIED by running a fresh kiosk child and a real HTTP request.
- **Where:** `agent/src/kiosk.js:47`, async request listener URL construction.
- **Evidence:** `checks/kiosk-malformed-host.mjs`,
  `baseline/kiosk-malformed-host.{txt,json}`: `Host: [` causes `ECONNRESET`,
  process exit 1, and `ERR_INVALID_URL`, instead of a client-error response.
- **Impact:** denial of kiosk service by a reachable HTTP client (loopback by
  default; broader reachability depends on configured binding).
- **Smallest fix:** parse against a trusted base or validate Host with handled
  errors; contain request-handler failures so they cannot escape the listener.
- **Effort/disposition:** small / AUTO.

### A04 — MEDIUM — Non-ASCII CSRF mismatch throws instead of returning 403

- **Status:** VERIFIED by invoking the actual middleware.
- **Where:** `server/src/middleware/csrf.js`, `verifyToken` token comparison.
- **Evidence:** `checks/csrf-unicode.mjs`, `baseline/csrf-unicode.{txt,json}`;
  error `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` with no 403 response.
- **Mechanism:** string length equality does not imply equal UTF-8 byte lengths.
- **Impact:** malformed authenticated requests reach the error handler rather
  than the expected CSRF refusal. No authentication bypass demonstrated.
- **Smallest fix:** compare encoded buffer lengths before timing-safe equality.
- **Effort/disposition:** small / AUTO.

### A10 — MEDIUM — Fractional waste posts a different amount from exact valuation

- **Status:** VERIFIED by running `checks/fractional-waste.mjs` through the real API.
- **Where:** `server/src/routes/cafeInventory.js:168-176` (floating-point sum
  before `moneyNumber`), compared with numeric valuation in
  `server/src/lib/cafeReports.js:56-62`.
- **Evidence:** `baseline/fractional-waste.{txt,json}`. A purchased product with
  cost 100 and waste quantity 0.145 posts **14**, although exact decimal 14.5
  rounds to **15** under the database's whole-Toman convention. Stock is 0.855.
- **Mechanism:** `0.145 * 100` is slightly below 14.5 in binary floating point;
  checking the already-rounded integer cannot recover the lost precision.
- **Impact:** inventory expense is understated; books and stock valuations drift.
- **Smallest fix:** value the transaction using PostgreSQL numeric arithmetic,
  then pass the resulting bigint string through `moneyNumber`.
- **Effort/disposition:** small / AUTO. Synthetic append-only records remain in
  the isolated audit DB; product and supplier were deactivated.

### A11 — MEDIUM — Zero-total student sales fail despite valid price/quantity

- **Status:** VERIFIED by running `checks/zero-price-student-sale.mjs`.
- **Where:** `server/src/lib/cafeSale.js:99-109,180-191`,
  `server/src/lib/cafeBalance.js:29-35`; database constraint
  `cafe_balance_charge_negative` (and positive refund constraint on void).
- **Evidence:** `baseline/zero-price-student-sale.{txt,json}`: price 0, quantity
  1, active student/product yields HTTP **500 / 23514**. API validation accepts
  zero price. Positive-priced tiny quantities can also round to zero total.
- **Mechanism:** sale always writes a `charge` of zero, which violates the
  ledger's negative-charge constraint; void likewise attempts a zero refund.
- **Impact:** free student transactions cannot be completed.
- **Smallest fix:** preserve sale/stock/COGS/audit behavior, skip a zero-value
  balance movement and return the unchanged balance; cover sale and void.
- **Effort/disposition:** small / AUTO; no schema change is needed.

### A13 — MEDIUM — Valid three-decimal quantities are rejected in four cafe flows

- **Status:** VERIFIED by the actual parsers and all four real HTTP endpoints.
- **Where:** `server/src/validation/cafe.js:186,221`,
  `server/src/validation/cafeInventory.js:21`.
- **Evidence:** `checks/three-decimal-quantity.mjs`,
  `continuation-01/three-decimal-quantity.{txt,json}`: purchase, sale and waste
  quantity `1.005`, and adjustment `-1.005`, all return HTTP 400 /
  `VALIDATION_INVALID_FORMAT`. Four-decimal negative controls also reject.
- **Mechanism:** exact integer comparison after binary multiplication rejects
  `1.005 * 1000 === 1004.9999999999999` despite its valid three-decimal input.
- **Impact:** supported fractional transactions cannot be entered reliably.
- **Smallest fix:** share a decimal-aware precision check for the existing
  three-decimal contract; preserve range/sign checks and reject genuinely finer
  precision. Exercise all four parsers and real endpoints.
- **Effort/disposition:** small / AUTO; existing contract, no schema change.

### A16 — MEDIUM — Missing microphone announces text fallback but starts no input loop

- **Status:** VERIFIED by executing a byte-identical copy of the real agent entrypoint.
- **Where:** `agent/src/index.js:145-154`.
- **Evidence:** `checks/agent-missing-mic-fallback.mjs`,
  `continuation-02/agent-missing-mic-fallback.{txt,json}`. With STT configured,
  no `arecord` on PATH and no `--text`, startup logs “falling back to text”;
  the REPL banner never appears. Sent `menu`/EOF is ignored and the harness
  terminates the still-running process after one second. Contract assertion fails.
- **Mechanism:** the fallback branch only logs; the separate REPL condition
  excludes precisely the `stt && !micOk && !textMode` case.
- **Impact:** the documented automatic fallback leaves an otherwise logged-in
  kiosk unable to accept terminal input on machines without microphone tooling.
- **Smallest fix:** start the text loop in the no-microphone fallback branch;
  retain the explicit text, voice and file-replay modes. Verify input/EOF handling.
- **Effort/disposition:** small / AUTO. The probe uses a local fake API and copied
  source under `audit/.tmp/` so transcript writes remain isolated. Physical audio
  and financial operations were not exercised.

### A17 — MEDIUM — Installed development tooling matches published vulnerable ranges

- **Status:** VERIFIED installed-version/advisory match; exploitation not executed.
- **Where:** `client/package-lock.json`; direct tooling declarations at
  `client/package.json:39-55`; `client/vite.config.js:26-42`.
- **Evidence:** `baseline/dependencies-client.txt` records five affected packages;
  `continuation-02/dependency-tree.txt` verifies Vite 8.3.0, Vitest/mocker 5.0.1,
  source-map-js 1.2.1 and Zod 4.6.5 in the installed development tree.
- **Impact:** conditional development-server file/command exposure and tooling
  denial-of-service risks. The application-specific rating is medium: these
  are development/build/lint tools, not established production request paths.
- **Smallest fix:** compatible patched dependency resolution (Vite >=8.3.3,
  Vitest/mocker >=5.0.3, source-map-js >=1.2.2, Zod >=4.6.6 per saved ranges),
  inspect the lock diff, and rerun audit/lint/tests/build. Confirm exact candidate
  releases before installation; do not use a forced major upgrade.
- **Effort/disposition:** small / AUTO for compatible patch-level updates only.
  Advisory-specific reachability and limitations: `DEPENDENCY_ASSESSMENT.md`.

### A19 — MEDIUM — Cohort trends average raw group rows rather than effective student scores

- **Status:** VERIFIED through the real trend and export endpoints.
- **Where:** `server/src/routes/dashboard.js:43-61`; full mirror read confirms
  analogous raw aggregation in `server/src/core/services/dashboard.js`. The core
  results service also consumes the shared defective helper (A18/A20); these
  mirror conclusions are source-established, not new mirror executions.
- **Evidence:** `continuation-03/scoring-report-consistency.{txt,json}`. The same
  single-session [8,2,2] effective cohort reports trend average **5**, count **2**,
  from raw [8,2], rather than average **4**, count **3**.
- **Mechanism:** `avg(e.quality_value)`/`count(*)` neither expands group scores
  nor removes the group contribution shadowed by a member's own cell.
- **Impact:** group-size-dependent trend bias and disagreement with export.
  Historical audit-notes #8's weighting problem still reproduces.
- **Smallest fix:** use session-date-eligible effective student cells before
  existing period average/count; cover member overrides and selected-empty shadows.
- **Effort/disposition:** medium / AUTO for the existing cohort interpretation;
  alternate period-weighting policy is ASK.

### A24 — MEDIUM — Runtime deployment grants allow erasing audit and stock history

- **Status:** VERIFIED using the unchanged deployment template in a rolled-back
  isolated PostgreSQL transaction; no deployed installation was tested or changed.
- **Where:** `deploy/postgres-roles.example.sql:20-25,43-47`; comparison with
  `partly-schema/schema-4-security.sql:38-41` and live stock/audit triggers.
- **Evidence:** `checks/deployment-ledger-grants.mjs`,
  `continuation-05/deployment-ledger-grants.{txt,json}`. New non-superuser,
  non-owner app role rewrites/deletes one audit row and truncates 19 stock
  movements to zero. Stock DELETE correctly raises `P0001` as a negative control.
- **Mechanism:** app-wide UPDATE/DELETE/TRUNCATE grants; audit has no equivalent
  mutation guard, and stock's row UPDATE/DELETE trigger cannot intercept TRUNCATE.
- **Impact:** direct runtime SQL/credential access can erase audit and inventory
  history despite the append-only design. No HTTP injection/exploit is demonstrated.
- **Smallest correct fix:** agree separate runtime and maintenance grants, remove
  runtime audit mutation/ledger TRUNCATE authority, and preserve explicit reset/
  seed/restore operations under the maintenance role.
- **Effort/disposition:** small-to-medium / ASK — deployment/maintenance privilege
  policy changes need approval. ROLLBACK restored exact history and captured ACLs;
  all temporary roles are absent. See `SCHEMA_REFERENCE_COMPARISON.md`.

### A20 — MEDIUM — Comment-aware dashboard counts unanswered cells as answered

- **Status:** VERIFIED by feeding a real results response to the same helpers
  imported by DashboardPage; no browser submission claimed for this check.
- **Where:** `server/src/lib/results.js:11-17,34-41` omits dimension comments;
  `client/src/lib/dashboard.js:24-30` compares missing properties with `!== null`.
- **Evidence:** `continuation-03/scoring-report-consistency.{txt,json}`. One
  quality score, one blank selected cell and one quantity-only note produce
  quality completion **33%** on value basis but **100%** on value-or-comment.
  Raw evaluation reads confirm only one cell answers quality under either basis.
- **Mechanism:** the API returns generic `answered` but no `qualityComment` or
  `quantityComment`; `undefined !== null` is true for every selected cell.
- **Impact:** blank/opposite-dimension cells falsely mark students complete and
  disappear from the missing-score list.
- **Smallest fix:** preserve dimension-specific answer information across the
  results/client boundary and treat missing data as unanswered. Merely replacing
  `!==` with `!=` would stop false positives but still lose genuine comment-only answers.
- **Effort/disposition:** small / AUTO for this integration mismatch. Add a
  real server-response-to-helper regression; current client tests invent comment
  properties the real results endpoint does not send.

### A25 — MEDIUM — Persian and Arabic-Indic digits block score entry

- **Status:** VERIFIED by actual Persian browser input and direct execution of
  the production parser/draft/payload helpers.
- **Where:** `client/src/lib/cells.js:24-32,66-77,118-131`; existing normalization
  contract at `client/src/lib/locale.js:27-33`.
- **Evidence:** `continuation-05/browser-scoring.md`: entering **۷ / ۶** disables
  Save and displays English `Enter a whole number.` errors; changing only the
  digits to **7 / 6** completes a real HTTP 200 save. Retained intended-contract
  regression `checks/localized-score-digits.test.mjs` has **2 passes / 4 failures**
  in `continuation-05/localized-score-digits.{txt,json}`. Arabic-Indic digits,
  numeric payload creation and same-value draft pruning also fail directly.
- **Mechanism:** ASCII-only integer validation runs before any digit normalization.
- **Impact:** users of Persian/Arabic-Indic keyboards cannot submit ordinary
  scores in the Persian-default app without switching numeral input.
- **Smallest fix:** normalize supported digits before strict whole-number and
  range validation, retaining null/zero, comments and no-op behavior. Keep syntax
  and out-of-range rejection controls; no API or storage change is needed.
- **Effort/disposition:** small / AUTO for the existing localized-input contract.
  Translating the helper's English-only validation text is a related UI gap;
  broad numeric-input redesign is outside this narrow fix.

### A26 — MEDIUM — POS quote disagrees with the charged whole-Toman amount

- **Status:** VERIFIED through the real purchase/POS browser workflow, captured
  HTTP responses, independent ledger readback and component execution.
- **Where:** `client/src/pages/CafeSalesPage.jsx:137-143,415-419`, compared with
  `server/src/lib/cafeSale.js:71-78` (exact numeric sum, then whole-Toman rounding).
- **Evidence:** `continuation-06/browser-finance.md`, `browser-finance-sold-readback`
  and `pos-rounding.{txt,json}`. Quantity **0.145** at unit price **100** displays
  **14** for both line and cart, but POST 201 charges **15**, balance **−15**.
  Stock and journal agree with the server amount. The component regression has
  **1 pass / 2 failures**: whole-quantity control passes; the half-boundary case
  fails, and two 0.005 × 100 lines quote **2** rather than exact aggregate **1**.
  The latter is component/source-established, not a second live sale.
- **Mechanism:** binary multiplication crosses a rounding boundary, and summing
  individually rounded lines differs from rounding the exact aggregate once.
- **Impact:** displayed checkout amount differs from the actual debit/receipt.
- **Smallest fix:** exact scaled-decimal quote calculation under the existing
  three-decimal quantity/whole-Toman price contract; round the aggregate once
  as the API does. Keep line display consistent at half boundaries. No server
  ledger or pricing-policy change is required.
- **Effort/disposition:** small / AUTO for matching the existing charge contract.
  Browser void restored balance 0 and stock 1; synthetic entities were archived/
  deactivated and append-only purchase/sale/void history retained.

### A27 — MEDIUM — Cafe sale/void leaves cached accounting totals and status unchanged

- **Status:** VERIFIED by component execution of the real POS, accounting journal
  and report pages with a shared QueryClient; backend I/O is mocked.
- **Where:** `client/src/pages/CafeSalesPage.jsx:182-190`; consumers at
  `AccountingJournalPage.jsx:252-264` and `AccountingReportsPage.jsx:39-58`;
  freshness contract at `client/src/main.jsx:34-43`.
- **Evidence:** `checks/accounting-cache.test.jsx`,
  `continuation-07/accounting-cache.{txt,json}`: **4 failures**. Visit accounting,
  record sale/void, return within the application's 30-second freshness window:
  totals remain **100 instead of 200**, or **200 instead of 100**; a new journal
  entry remains absent, or a voided entry remains **Posted**. Each consumer makes
  only its initial fetch. Explicit-refresh controls display every expected value.
- **Mechanism:** invalidating `accounting-entries`/`accounting-reports` does not
  match the actual journal or individual report keys. Returning while cached data
  is fresh skips refetching; reaching staleTime alone does not initiate a fetch.
- **Impact:** financial screens can contradict a successful transaction until
  another refetch trigger. No persisted ledger error is established by this probe.
- **Smallest fix:** invalidate the actual affected financial query families after
  successful writes; share this mapping across existing financial mutations.
  Student balance uses the same wrong keys; purchase/inventory and journal
  post/void/period actions also omit affected report invalidation (source-only
  extensions, not additional executed cases).
- **Effort/disposition:** small / AUTO for existing cache-consistency behavior.
  Native browser route navigation and real backend writes are not part of this
  particular reproduction.

### A28 — MEDIUM — Linux installer bootstraps the default cluster instead of its configured target

- **Status:** VERIFIED by running a byte-identical setup entrypoint with isolated
  fake CLI dispatchers; no real sudo, PostgreSQL, installation or network writes.
- **Where:** `scripts/setup.mjs:279-281,304-309,333-341`.
- **Evidence:** `checks/setup-target.test.mjs`,
  `continuation-07/setup-target-02.{txt,json}`: **1 pass / 1 failure**. Existing
  synthetic configuration points at `127.0.0.1:55439`; available-sudo path sends
  both privileged probe and bootstrap SQL without host/port, dispatched to
  `local-socket:5432`, then fails its application connection at the configured
  endpoint. Unavailable-sudo control passes host/port explicitly and connects
  successfully after bootstrap. Control execution intentionally stops before
  later configuration/install/build stages.
- **Mechanism:** a successful local sudo probe selects an endpoint-independent
  privileged path even for a nondefault configured target.
- **Impact:** setup can create objects in an unintended local cluster while
  leaving the requested installation unconfigured. Real wrong-cluster writes
  have not been performed; default endpoint resolution is modeled by the dispatcher.
- **Smallest fix:** make privileged probe/bootstrap honor the selected endpoint;
  use local peer access only when it is demonstrably the intended cluster and
  otherwise retain the explicit network path. Cover nondefault ports/remote hosts
  and the existing local setup control.
- **Effort/disposition:** small / AUTO for respecting the existing target choice;
  no change to role privileges or database schema is authorized.
  The initial `setup-target` run stopped at an overly strict harness assertion
  about the diagnostic connection count; retained but excluded as defect evidence.

### A29 — MEDIUM — Failed permission-catalog request lets role editing crash the interface

- **Status:** VERIFIED by real RolesPage/QueryClient/ErrorBoundary component
  execution with mocked API I/O; no live endpoint outage was induced.
- **Where:** `client/src/pages/RolesPage.jsx:220-242,337-340,52-61`.
- **Evidence:** `checks/role-catalog.test.jsx`,
  `continuation-08/role-catalog.{txt,json}`: **1 pass / 2 failures**. Role list
  succeeds, initial catalog request fails and settles; both New role and Edit
  stay enabled. Activating either throws `Cannot read properties of undefined
  (reading 'permissions')` and renders the application error boundary. Successful
  catalog control opens the existing role with its selected permission intact.
- **Mechanism:** loading checks cover both queries, but the error check covers
  only the role list. Undefined catalog data reaches PermissionEditor.
- **Impact:** an otherwise recoverable request failure removes the interface and
  forces a reload when an administrator attempts to edit/create a role.
- **Smallest fix:** handle initial catalog errors before enabling/rendering the
  editor using the existing page-level load-error pattern. Retain the successful
  catalog path and verify both editor entry points.
- **Effort/disposition:** small / AUTO for error containment; no permission or API
  behavior change is needed.

### A30 — MEDIUM — Monthly schedule preview shows a date outside the actual recurrence

- **Status:** VERIFIED by actual SchedulePage component execution with a fixed
  clock and mocked read I/O, plus independent real PostgreSQL date arithmetic.
- **Where:** `client/src/pages/SchedulePage.jsx:51-71,621,653-654`, compared with
  anchored generation at `server/src/lib/sessions.js:30-40`.
- **Evidence:** `checks/schedule-calendar.test.jsx` and
  `continuation-08/schedule-calendar.{txt,json}`: **3 pass / 2 fail**. On February 1,
  a monthly January 31 anchor displays **March 3, 2026** rather than **February 28**;
  the leap-year case displays **March 2, 2028** rather than **February 29**. Weekly,
  mid-month and future-anchor controls pass. `schedule-calendar-sql.{txt,json}`
  passes all five fixed expectations using the generator's anchor+n×interval
  expression on isolated PostgreSQL. No sessions were created by this probe.
- **Mechanism:** repeated `Date.setMonth` overflows short months and then advances
  from the drifted date. PostgreSQL computes each occurrence from the original
  anchor and clamps the day for the destination month.
- **Impact:** users see a misleading next meeting date even though generated
  session dates follow the documented anchored calendar.
- **Smallest fix:** calculate each monthly candidate from the original anchor
  with destination-month clamping; preserve the existing recurrence contract and
  daily/future controls. Do not redefine monthly scheduling semantics.
- **Effort/disposition:** small / AUTO for client/server date consistency.

### A31 — MEDIUM — Production CSP blocks every attempted PNG chart export

- **Status:** VERIFIED in the actual production browser, not jsdom.
- **Where:** `client/src/lib/chartImage.js:76-104`,
  `client/src/components/ExportRunButton.jsx:121-123`, `server/src/index.js:130`.
- **Evidence:** `continuation-09/browser-export.md`: valid Speed trend → PNG
  Export fails with **Could not rasterize the chart SVG**, no new download, and
  an explicit browser CSP violation for the blob image URL. Actual response
  policy is `img-src 'self' data:`. The same live SVG loaded via data URL and
  canvas encoded successfully under unchanged CSP (382-byte PNG capability control).
- **Impact/mechanism:** default chart format is PNG, but the helper's blob URL
  is disallowed by the shipped image policy; canvas feature detection passes and
  the failure does not fall back to SVG.
- **Smallest fix:** load the locally serialized SVG through the already-allowed
  data-image path, retaining URL cleanup/error behavior as applicable. Verify a
  complete chart PNG download in production with CSP intact.
- **Effort/disposition:** small / AUTO; no policy relaxation required.

### A32 — MEDIUM — Chart export downloads a legend swatch instead of plotted data

- **Status:** VERIFIED by actual Chromium download and real component/Recharts
  execution (only layout APIs and final download I/O mocked in component tests).
- **Where:** `client/src/components/ExportRunButton.jsx:114-127` selects the first
  SVG; `TrendChart.jsx:66`, `ComparisonChart.jsx:63,96` render a legend before the plot.
- **Evidence:** `continuation-09/chart-1-trend-original.svg` is a valid **2250-byte,
  14×14 legend icon**, while the visible chart has a separate 391×280 plot SVG.
  `export-ui-02.{txt,json}` fails trend, comparison-bar and comparison-radar
  captured-data assertions; all three emit 14×14 legend-only SVGs. Heatmap capture
  control passes. Full reproduction and file ID are in `browser-export.md`.
- **Impact:** successful download notification accompanies an image without axes
  or scores. Fixing A31 alone would still rasterize this wrong SVG.
- **Smallest fix:** capture the actual plot root using an explicit chart-root
  contract, preserving heatmap support; verify plotted marks and dimensions in
  downloaded SVG and PNG.
- **Effort/disposition:** small / AUTO.

### A33 — MEDIUM — Explicit export period selection still downloads other periods' scores

- **Status:** VERIFIED in actual UI/request/download, with an independent real
  API filter control and a component-to-adapter regression.
- **Where:** `client/src/pages/ExportPage.jsx:53-68` creates `scope.periods`, but
  `client/src/api/export.js:9-12` reads `scope.seqs`.
- **Evidence:** selected only period 1 for Sample Group A weekly; captured 200
  POST contains only assignmentId. Download `selected-period-1-original.csv`
  contains **30 data rows spanning periods 1 and 2**. Direct `periods:[1]` API
  control returns 210 cells, all periodSeq=1. See
  `continuation-09/export-period-control-02.{txt,json}` and `browser-export.md`.
  Actual page/API adapter test in `export-ui-02` exports both synthetic scores
  **2 and 9**, rather than selected period-1 score **2**; all-calendar control passes.
- **Impact:** exports exceed the user's selected reporting slice and can be
  shared with unintended historical scores. This is not an authorization bypass.
- **Smallest fix:** align the page/adapter scope property and retain selected/all
  download regressions. The API's extra period metadata is a separately recorded
  source/response limitation; this finding's assertions target exported score rows.
- **Effort/disposition:** small / AUTO.

### A34 — MEDIUM — Export chart period controls show empty or wrong-period values

- **Status:** VERIFIED by real component execution and actual Persian browser.
- **Where:** `ExportPreview.jsx:18-23,33-40` passes obsolete `periodNumber`, while
  `ChartConfigPanel.jsx:130-132,178-180` stores `periodKey`;
  `DistributionChart.jsx:31-35` also passes the `cube.lastPeriod` object where
  `cubeValues` requires a string key (`lib/cube.js:127-135,181-185`).
- **Evidence:** `continuation-09/export-ui-02.{txt,json}`: selecting period 1
  leaves a heatmap cell at latest-period **9** instead of **2**. Distribution
  default renders no nonzero bar despite the fixture's score; passing an explicit
  period key directly to the component renders a data bar (positive control).
  Actual browser Speed distribution is empty for selected periods 1/2; heatmap
  selector says 1 while caption names key …:2 and Sample Student 01 shows **44**,
  versus period-1 **64** in the retained CSV. See `browser-export.md`.
- **Impact:** chart images can silently represent a different period, or display
  an empty distribution for recorded scores.
- **Smallest fix:** carry the same period key through picker, preview and renderer;
  use the latest bucket's key for the fallback. Verify both explicit and default
  paths without changing aggregation policy.
- **Effort/disposition:** small / AUTO. Chart-prefill normalization also uses `seq`
  rather than `periodKey`; this adjacent extension remains source-only.

### A35 — MEDIUM — Export charts lose readable, distinguishable period labels

- **Status:** VERIFIED in actual Persian browser and bilingual component checks.
- **Where:** `TrendChart.jsx:37`, `ComparisonChart.jsx:41` request absent
  `shared.periodKey` (both locale files define `shared.periodLabel`);
  `lib/heatmap.js:53-55`, `HeatmapMatrix.jsx:58` truncate UUID-based period keys.
- **Evidence:** `continuation-09/export-labels.{txt,json}` has two failing language
  cases, each confirming trend/comparison labels are literally **shared.periodKey**
  and two heatmap headers collapse to identical **P000000…**. Actual browser trend
  repeats the same raw key; its two heatmap columns both show **Pb61de1…**.
- **Impact:** users cannot identify which assignment-period a plotted point or
  heatmap column represents, even where numeric values are present.
- **Smallest fix:** use the existing translated period-label contract and readable
  assignment/sequence labels; keep identifying information available if shortened.
- **Effort/disposition:** small / AUTO for label correctness, preserving chart data.

### A36 — MEDIUM — Scheduling quick actions silently discard useful API errors

- **Status:** VERIFIED in actual Persian browser and bilingual component tests.
- **Where:** `client/src/pages/SessionsPage.jsx:476-480,726-748` and
  `client/src/pages/SchedulePage.jsx:540-544,659-667` create mutations without
  presenting their errors. The session Edit form already presents the same error
  at `SessionsPage.jsx:110`.
- **Evidence:** `continuation-10/browser-scheduling.md`: quick Cancel on a session
  with 16 evaluations returns **409 SESSIONS_HAS_EVALUATIONS**; restored archived
  assignment with an archived group returns **400 ASSIGNMENTS_GROUP_INACTIVE**.
  In both cases buttons re-enable with no error or explanation. Actual session
  Edit → Canceled → Save returns the same 409 and displays the translated error.
  Corrected `scheduling-errors-03.{txt,json}` has **4 failures / 2 passing controls**
  across English and Persian, using real pages/adapters and mocked HTTP I/O.
- **Impact:** users cannot tell why actions failed or what prerequisite to fix;
  server protections correctly preserve the data.
- **Smallest fix:** render these mutation errors using the existing
  `errorMessage`/error-alert pattern, with stale errors cleared when retrying.
  Retain the actual refusal and edit-form control regressions.
- **Effort/disposition:** small / AUTO. Teacher, interval, template and alert
  quick-action omissions remain source-only adjacent paths. Successful session
  archive → unarchive was separately verified and restored the original response
  fields/period membership; it is not a refusal defect.

### A05 — LOW — Walk-in sale adapter returns `NaN` for absent balance

- **Status:** VERIFIED against the real adapter and isolated server.
- **Where:** `agent/src/panel.js`, `recordSale`/balance response conversion.
- **Evidence:** `checks/walk-in-response.mjs`,
  `baseline/walk-in-response.{txt,json}`. `balanceIsNaN:true`,
  `balanceIsNull:false`; created audit sale was voided in cleanup.
- **Impact:** invalid receipt/balance speech for walk-in transactions.
- **Smallest fix:** normalize absent balances to null before numeric conversion.
- **Effort/disposition:** small / AUTO.

### A06 — LOW — Android example tests do not verify the shipped application

- **Status:** VERIFIED by reading; Android runtime failure not executed.
- **Where:** `client/android/app/src/test/java/com/getcapacitor/myapp/ExampleUnitTest.java:15-16`
  only asserts arithmetic. `client/android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java:24`
  expects `com.getcapacitor.app`, while `client/android/app/build.gradle:7`
  sets `app.studentpanel.mobile`.
- **Impact:** unit test gives no product assurance; instrumentation assertion is
  inconsistent with the configured application ID.
- **Effort/disposition:** small / AUTO for incorrect assertion; uncertain test
  deletion remains ASK. See test-quality ledger.

### A15 — LOW — Mobile navigation opens without moving or containing keyboard focus

- **Status:** VERIFIED with real browser click/Tab/Escape at 454 × 612 Persian/RTL,
  repeated with native Enter/Tab/Shift+Tab/Escape at 480 × 597.
- **Where:** `client/src/components/Layout.jsx:80-105` and
  `client/src/index.css:1623-1627`.
- **Evidence:** `continuation-02/browser-workflows.md`: opening the menu leaves
  focus on `.nav-toggle`; Tab moves to the page's student-mode radio behind the
  overlay. Escape correctly closes and restores toggle focus.
  `continuation-11/browser-menu.md` and retained Code Mode regression
  `checks/menu-focus.browser.js` add **4 failing / 2 passing** native assertions:
  Shift+Tab from the first visible control escapes to the skip link; Tab from
  the last control stalls there. Escape and closed-sidebar inertness pass.
- **Mechanism:** the focus selector includes the mobile-hidden `.rail-toggle`
  as its first element. Focusing it is ineffective; wrap logic also treats that
  hidden element as the first focus target.
- **Impact:** keyboard navigation reaches obscured controls instead of the open menu.
- **Smallest fix:** select genuinely visible/enabled focus targets and guard
  focus entering/leaving the open mobile overlay; verify both Tab directions
  and Escape using actual browser key input.
- **Effort/disposition:** small / AUTO, narrow accessibility correction.

## Additional workbook/browser verification

`continuation-02/workbook-generation.{txt,json}` passes: the actual lazy XLSX
writer generates two sheets whose ZIP CRCs, XML relationships, types, Unicode,
blank/nonfinite handling and formula guards pass independent stdlib validation.
The actual export UI also downloaded Scores + Changes; retained workbook bytes
are in `continuation-01/ui-export.xlsx`. Independent validation passes with
168 and 106 rows respectively, including known preview values. Details and
keyboard failure A15 are in `continuation-02/browser-workflows.md`.

`continuation-05/browser-scoring.md` records an actual sighted-group save at
480 × 597 Persian/RTL: **7 / 6** plus a Persian quality comment, HTTP **200 /
changed:1**, success banner, disabled clean-state controls and independent API
readback. Blind entry reproduces A21. Native override prompt testing is blocked
by the browser host's `prompt() is not supported` error; no override request
occurred. Discard restored the original locked score; fixture cleanup and
independent verification are retained beside this evidence.

`continuation-06/browser-finance.md` records actual purchase → student sale with
overdraft → confirmed void. Independent stock/balance/source-journal readbacks
verify the cycle and cleanup while preserving append-only history. Its initial
post-archive verifier incorrectly expected an active-student API response;
corrected `browser-finance-cleanup-verify-02` passes with inspected SELECT-only
ledger checks. Both outputs are retained. `browser-groups.md` records actual
Add → Remove → Re-add → Remove and two distinct preserved membership rows;
independent counts and cleanup pass. DOM control activation was used after
pointer-tool errors, so pointer hit-testing remains unverified.

`continuation-07/browser-journal.md` records actual Persian journal draft → post →
void with **۳۲۱** inputs and an unbalanced 321/320 disabled-submit control.
Captured HTTP outcomes are **201 / 200 / 200**. Independent SQL/API readbacks
establish unchanged line IDs, balanced 321/321 totals, posted-report deltas +321,
then exact restoration of trial balance, income, balance sheet and cash ledger.
The user confirmed the void dialog; unsuccessful keyboard attempts are recorded
as inconclusive, not a product defect. The fixture is settled and history retained.

`continuation-08/privacy-auth.md` records **25 passing / 3 failing** real HTTP/SQL
assertion groups: A07's archived-field leak now includes PATCH responses; audit
redaction, restricted-write rejection, password-change gating, role re-derivation,
reset and deactivation session eviction pass. SELECT-verified cleanup retains
history. The original probe-envelope mismatch is retained as a harness error.

## Agent provider resilience assessment

`continuation-02/agent-provider-deadlines.{txt,json}` records a controlled local
HTTP probe of OpenAI-compatible chat, Ollama chat, STT, TTS and a Panel read.
All five requests omit an application abort signal and remain pending through
the measured **1500 ms** observation. No dialogue reply occurs before release;
releasing HTTP 503 lets the dialogue fall back to the deterministic rules.
The Ollama startup availability probe separately has a 1000 ms deadline
(`agent/src/llm.js:35-43`). This does **not** establish indefinite hanging or a
breach of an agreed response deadline. Runtime/network timeouts may still apply.

**Disposition: resilience suggestion / ASK**, not an additional verified defect.
Agree per-provider and whole-turn budgets plus cancellation behavior before
changing them. Panel financial writes require an explicit unknown-outcome policy:
aborting a client request does not establish that a server transaction failed.
The probe performs no real provider, audio or financial writes.

## Test interpretation and remaining questions

- Permission integration success checks often exclude only 401/403, permitting
  500. Passing this suite alone does not prove an endpoint succeeded.
- PGlite services are a framework-free mirror, not the Express route path.
  Their tests do not prove production permissions, middleware, or concurrency.
- PGlite verifier's rejection helper accepts arbitrary errors for some guards;
  each rejection should assert the expected database code/constraint.
- Integration cleanup removes alerts/audit rows outside its initial snapshot;
  isolated database usage is required to avoid affecting concurrent work.
- Dependency version/reachability assessment is recorded in
  `DEPENDENCY_ASSESSMENT.md` (A17). Server/agent scans reported zero.
- Missing-microphone fallback is A16; provider deadlines are assessed above.
- Migration 029 destroys prior score/history/view data and mentions approval.
  Historical approval/intent is a QUESTION, not permission to rewrite it.
- Historical report and supplied-reference reconciliation is recorded in
  `PRIOR_AUDIT_RECONCILIATION.md` and `SCHEMA_REFERENCE_COMPARISON.md`.
- Completion-denominator policy remains ASK: the new real workflow with one
  selected answered cell among three members yields dashboard expected=3 /
  completion=33%, but `/dashboard/summary` expected=1 / answered=1. Client tests
  explicitly prescribe roster × in-use parameters; schema-adaptation docs call
  completion selected-cell-based. This measured discrepancy needs a product
  decision and is separate from A18–A20's unambiguous data loss/false answers.

## Coverage and unverified scope

`inventory.json` preserves initial hashes and per-file full-read status;
`record-review.mjs` records completed full reads. A search, import scan, or
passing test does not mark a source file fully reviewed.

All 65 existing automated test files have quality judgments in `TEST_QUALITY.md`.
**499 initial-inventory files / 74,842 text lines** are recorded as fully read,
including all **461 tracked text files**, the supplied schema references and
native Android source/configuration. `COVERAGE.md` and the executed
`continuation-12/coverage-reconcile.{txt,json}` account for every remaining entry
without marking generated/binary/runtime material as fully read. All 629
non-secret inventory files still match their original hashes; two secret files
were intentionally not opened.
Continuation-09 adds actual production PNG/SVG and selected-period CSV workflows,
real chart/adapter component regressions and independently inspected downloaded
bytes. Export findings A31–A35 distinguish executed behavior from source-only
extensions; `continuation-09/browser-export.md` records host/probe limitations.
Continuation-10 records the pending 27 component reads, the full WebGL hero,
deployment/client configuration and five locale files. Actual scheduling refusals
and their positive control establish A36 (`continuation-10/browser-scheduling.md`).
The three supplied `partly-schema/` files and historical audit documents have
been fully read and reconciled in the comparison documents. Continuation-12 adds
native language/theme save/reload/restoration and two successful instrumented
route-heading focus controls. Browser blind/individual scoring and CSV
confirmation remain blocked until A21/A22 are fixed. Other explicit boundaries:
native override UI in a supporting host, desktop layout/focus,
spreadsheet-application interoperability, Android/device, real speech/model
providers and sustained load. Dependency reachability is assessed, not exploit-tested.
No project type-check command/configuration was found. Limited credential
scanning covered tracked text and 7 reachable commits, not all external data.

## Stage 2 gate

The gate is satisfied: complete authored-source reads, test-quality ratings,
prior-audit reconciliation, retained failing reproductions, feasible critical
workflows, explicit environmental/product-blocked gaps, and final passing project
checks. Create `audit-fixes`, initialize `FIX_LOG.md`, and fix AUTO findings in
severity order with retained reproductions and separate named-path local commits.
Blocked successful browser flows must be retried after their fixes. Skip ASK
changes and continue. Never publish.
