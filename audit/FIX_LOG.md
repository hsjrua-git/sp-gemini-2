# Stage 2 fix log

Branch: `audit-fixes`. Baseline: `a4d81f07d2e016341310dc8df79b9c878cf32ada`.
Started 2026-10-30 local time after the Stage 1 gate passed. Baseline findings
and failing evidence are retained unchanged; completed fixes are recorded here.
All work and commits are local.

## Baseline verification

`stage1-final/`: lint/build pass; client 214, server 135 (six integration skips),
agent 21, core 55, separate HTTP integration six pass. PGlite applies all 35
migrations and passes sanity checks. Serial stock/sale/reports/alerts/invariant/
accounting smokes pass. `COVERAGE.md` records 499 full reads and explicit limits.

## Ordered work queue

- HIGH AUTO: A01, A02, A03, A07, A14, A18, A21, A22.
- MEDIUM AUTO: A04, A08, A10, A11, A13, A16, A17, A19, A20, A25–A36.
- LOW AUTO: A05, A06 (incorrect assertion only), A15.
- ASK, deferred: A09 void confirmation, A12 refund/ledger semantics, A23 partial
  import contract, A24 deployment grants. Broader aggregation/weighting,
  completion denominator, provider budgets, migrations and uncertain deletions
  retain their recorded approval boundaries.

## Fixes

### A01 — filename-safe backup retention

- Replaced whitespace/line-delimited pruning with Bash array ordering by mtime
  and quoted deletion of complete paths in `deploy/backup.sh`.
- Retained `server/test/backupRetention.test.js`: spaced/tab/newline/quoted
  directories, mtime order contrary to names, KEEP=0, unrelated-file preservation,
  valid compressed output, and failed-dump cleanup. Baseline **3 fail / 1 pass**;
  fixed **4/4 pass** (`fix-a01/before-regression` and `after-regression`).
- Original real-`pg_dump` reproduction now preserves the unrelated sentinel,
  removes the expired backup and retains exactly one dump. Bash syntax passes.
- Full server suite: **139 pass / six integration skips**, exit 0. Other full
  suite results remain the Stage 1 baseline pending the Stage 2 checkpoint run.
- Evidence: `fix-a01/*.{txt,json}`. Original failing evidence is preserved.

### A02 — serialize the active-manager invariant

- Added `server/src/lib/managerInvariant.js`; role create/edit/delete and user
  create/edit acquire one transaction-scoped advisory lock before any row locks
  or capability reads. User edits now lock their target after the shared lock.
- Rechecked MCP identity (still the unrelated port-5432 database); inspected the
  pinned isolated database's roles, permissions, users, indexes and constraints.
  Schema evidence is in `fix-a02/schema.txt`; no migration was needed.
- Strengthened both retained HTTP races to require exactly **200 + 409**, the
  matching `*_LAST_MANAGER` code, and exactly one active holder for each key.
  Both fail before the fix with **200 + 200 / zero managers**.
- After the controlled API restart, role/role and role/user pass. Forced
  user-first deactivation and user-first demotion also pass; the role change is
  refused in those orderings. All fixture roles/active states are restored.
- Full server suite: **139 pass / six skips**. Separate HTTP integration **6/6**
  and serial stock **6**, sale/report **8+5**, alerts **6**, invariant **5**, and
  accounting **9** smokes pass. Evidence: `fix-a02/*.{txt,json}`.

### A03 — single-flight kiosk sale submission

- Sale authorization is consumed synchronously before adapter I/O. A detached
  request snapshot and an in-flight guard protect the cart/customer while the
  request settles; screen/speech input receives a bilingual pending response.
- Cart edits/cancellation and direct tool re-entry are refused during submission.
  A student lookup started against an earlier cart cannot attach to a later one.
  Failure retains the cart but clears confirmation, requiring a fresh protocol.
- Seven permanent adapter-level regressions: stages 2/3/4 overlapping input,
  pending edits/re-entry, delayed attachment, failure/reconfirmation and a
  nonempty-cart model-boundary control. Baseline **five fail / two pass**; fixed
  **7/7 pass**. Original reproduction now produces exactly **one** sale request.
- Full agent suite **28/28 pass**. Evidence: `fix-a03/*.{txt,json}`. These tests
  exercise real dialogue/tool handlers with a delayed adapter, not real charges.
  Cross-process idempotency and A09's void protocol remain ASK.

### A07 — retain privacy after field archiving

- Student response filtering loads active and archived field definitions. Create
  and update validation still accepts only active, permitted definitions.
- Real schema inspection retained in `fix-a07/schema.txt`. The expanded privacy/
  auth matrix fails **three** archived detail/list/PATCH checks before restart
  (**29 pass**) and passes **32/32** after restart. Privileged reads, public
  values, archived-write refusal, audit redaction and session controls pass.
- Original viewer-only reproduction also passes; fixtures are archived/settled
  with independent cleanup checks. Full server suite: **139 pass / six skips**.
- Evidence: `fix-a07/*.{txt,json}`; retained regression is
  `checks/privacy-auth-matrix.mjs` plus the original archived-field probe.

### A14 — close the blind locked-score equality oracle

- Locked writes by users without `scores.view` now receive the lock refusal
  regardless of whether their submitted values match. Sighted unchanged writes
  still succeed without changing timestamps or audit history.
- Permanent lock/preview controls cover matching guesses, changed values,
  deselection, blank group cells, unlocked/missing cells and redacted previews.
  Baseline **20 pass / one fail**; patched **21/21 pass**.
- Retained real HTTP oracle previously recovered the exact score; after restart,
  all **ten guesses return 409 / LOCKED**, every preview is redacted, and scores,
  timestamps and audits are unchanged. Sighted locked no-op and other scoring/
  override/export controls pass. Evidence: `fix-a14-before/` and `fix-a14/`.
- Full server suite: **140 pass / six integration skips**, exit 0. The probe's
  cube outputs now use a caller-selected phase and exclusive creation so reruns
  cannot overwrite existing evidence.

### A18 — resolve group fallback before period aggregation

- Results now expand group cells only onto session-date-eligible memberships;
  any own cell (including selected-empty or single-dimension) shadows that
  session's group cell. Current and previous periods use the same resolution.
- HTTP and PGlite result queries both supply ISO session dates and membership
  bounds. The established latest-non-null cross-session merge is preserved.
  Real schema/index/constraint inspection: `fix-a18/schema.txt`.
- Pure regressions: baseline **six pass / three fail**, patched **9/9 pass**.
  PGlite results/dashboard suite: **5/5 pass**, including inclusive join/leave
  boundaries, prior-period inheritance and empty shadows. Its first baseline
  run also contains one fixture-range error (quantity 12 for max 10), corrected
  to 6; that failure is not product evidence. The other baseline failure confirms
  missing prior group values.
- Real HTTP reproduction now returns **[8,2,2]**, matching export; dashboard
  completion is **100%** and average **4**. The combined probe exits 1 only for
  the separate, still-open A19 trend and A20 dimension-comment contracts.
- Full server suite **144 pass / six skips**. Evidence: `fix-a18/*.{txt,json}`.

### A21 — usable individual and blind scoring grids

- Loading/error gates now include required parameters/sessions and only the
  applicable saved-score/roster queries. Empty-session UI waits for success.
  Individual rows safely display a missing student code.
- Permanent component regression: baseline **four fail / five pass**; final
  **9/9 pass**. The intermediate run exposed the previously masked null-code
  crash (two individual cases); both original and intermediate failures remain.
  Coverage includes all four sighted/blind × group/individual saves, required
  dependency failures/loading and no-session state.
- Live production-build retry passes sighted individual **8/4**, blind group
  member **6/1**, blind individual **5/0**; each PUT returns **200 / changed:1**.
  Independent readback matches, existing values stay hidden from blind entry.
  Viewer restored; shared fixture cleanup verified with A22.
- Evidence: `fix-a21/`, `fix-a22/browser-cleanup-verified.*`. Client lint and full
  **230-test** suite pass (`stage2-high-checkpoint/`); production build passes.
  Full core **56/56** and PGlite **35 migrations plus sanity checks** also pass.

### A22 — render scalar score-import previews

- Preview cells select qualityValue/quantityValue from the server's nested
  snapshots, preserving zero, blank fallback and redacted previous values.
- Seven permanent component cases use the real server preview builder for new,
  changed, unchanged, blind, locked and blank values. Baseline **seven failures**;
  patched **7/7 pass**, including permitted/disabled confirmation controls.
- Real file upload/check/confirm now passes: preview **6→0 / 1→5** and **— / 7**,
  one new/one changed score; dryRun **200**, confirmation **200 / changed:2**.
  Independent readback matches. No console error; fixture cleanup independently
  verified. Evidence: `fix-a22/`, including the exact uploaded CSV and browser log.
- Production build and full client **230/230**, lint, core **56/56**, PGlite all
  pass at the shared HIGH checkpoint. Partial-import semantics remain A23/ASK.

### A04 — compare CSRF token byte lengths

- Encodes both tokens before the length check and timing-safe comparison.
  Mismatched ASCII/Unicode input now returns the established 403/CSRF response.
- Retained middleware regression covers both mismatch directions, surrogate-pair
  input, same-byte-length mismatch and matching Unicode control. Baseline
  **11 pass / one exception**; patched **12/12 pass**. Original reproduction
  returns **403**, no exception. Full server suite **145 pass / six skips**.
- Evidence: `fix-a04/`. Shared lint/build/client/core/PGlite checkpoint remains
  valid for the unchanged packages; this narrow change is middleware-only.

### A08 — contain kiosk request failures

- Malformed URL/Host input returns 400; rejected asynchronous dialogue handlers
  return a detail-free 500 instead of escaping Node's HTTP listener. The kiosk
  continues serving subsequent requests and retains its origin check.
- Four retained real-HTTP child-process regressions: malformed Host, malformed
  absolute URL, rejected confirm and rejected cancel. Baseline **four socket-reset
  failures**; patched **4/4 pass**, including subsequent page/origin controls and
  successful confirm retry. Original malformed-Host reproduction returns **400**.
- Full agent suite **32/32 pass**. Evidence: `fix-a08/`. Synthetic dialogue
  handlers only; no provider or financial I/O. Shared build/lint checks stand.

### A10 — exact decimal waste valuation

- The stock insert returns its numeric quantities/costs into a SQL aggregate;
  PostgreSQL rounds the exact transaction total once to bigint. `moneyNumber`
  still enforces safe HTTP/accounting conversion before posting.
- Rechecked MCP identity (unrelated port 5432); inspected the pinned isolated
  schema/indexes/constraints (`fix-a10/schema.txt`). No migration or core mirror
  change: the inventory write exists only in the HTTP route.
- Retained six-case real-HTTP regression: half boundary, below/above, multi-line
  aggregate, rounds-to-zero and whole-unit controls. Baseline **five pass / one
  fail**; patched **6/6 pass**, with stock readback. Original **0.145×100** now
  posts **15**, stock **0.855**. Accounting smoke **9/9**; server **145/six skips**.
- Evidence: `fix-a10/`; synthetic products/suppliers deactivated; append-only
  purchase/waste/journal evidence retained in the isolated database.

### A11 — zero-total student sale and void

- Zero-total student transactions read the existing balance (zero when absent)
  instead of writing a forbidden zero charge/refund. Stock, COGS and sale/void
  audits retain their normal lifecycle. Live schema inspection: `fix-a11/schema.*`.
- Retained four-case HTTP regression covers free and positive-price tiny sales,
  each with absent and existing negative balances. Baseline all four return
  500/23514; patched all four pass, including COGS post/void, stock restoration,
  unchanged balance rows/timestamps/history, two audits and repeated-void refusal.
- Original reproduction passes. One intermediate harness run used a top-level
  balance property and expected 200 for the actual 201 void response; corrected
  run passes. Its already-voided fixture and failure evidence are preserved.
- Separate HTTP integration **6/6** and serial stock **6**, sales/reports **8+5**,
  alerts **6**, races **5**, accounting **9** pass (`fix-a11-serial/`).
- Full server suite includes the next A13 regressions: **149 pass / six skips**.
  Shared client lint/build/core checkpoint remains applicable. No schema change.

### A13 — decimal-aware cafe quantity validation

- Shared decimal round-trip precision check accepts exact thousandths without
  multiplication error; existing sign/range/duplicate constraints still apply.
- Four retained parser regressions change from **4 failures** to **4 passes**,
  each sweeping 2,000 thousandths plus string/exponent, bounds, finer-precision
  and sign controls. Original HTTP probe now passes purchase/sale/waste **1.005**
  and adjustment **−1.005**; four-decimal controls still reject.
- Corrected the original probe's previously unreachable cleanup expectation to
  the documented 201 void response. Baseline failing output remains unchanged.
- Evidence: `fix-a13/`; full server **149/six skips** at `fix-a11/tests-server.*`.
  Synthetic sale voided and product/supplier deactivated. No database-code change.

### A16 — activate the missing-microphone text fallback

- The input-loop condition now includes unavailable microphone tooling.
- Strengthened retained entrypoint probe sends `menu`, waits for product API I/O,
  then EOF. Baseline announces fallback but processes no input and needs SIGTERM;
  patched fallback, explicit `--text`, and no-STT controls all start the REPL,
  reach the dialogue and exit **0** on EOF. Source copies are byte-identical.
- Intermediate probes wrongly required one product fetch; the real dialogue
  fetches its initial catalog and menu separately. Corrected assertion tests
  input delivery; all original outputs remain in `fix-a16/`.
- Full agent suite **32/32** passes. Local fake API, isolated transcript files;
  physical microphone, providers and replay audio remain unexecuted.

### A19 — effective student trend aggregation

- HTTP and core queries expand session-date-eligible memberships and resolve
  own-cell shadows (including empty cells) before the existing average/count.
  Inspected isolated schema/indexes/constraints in `fix-a19/schema.*`.
- New core regression fails baseline **5 ≠ 4**; both trend tests now pass,
  covering inclusive membership dates, both dimensions, empty shadows and an
  individual zero score. Real HTTP/export comparison now reports **4 / 3** for
  [8,2,2], with A18 also passing. The same run still fails A20, explicitly retained
  at `after-http-before-a20.*`; synthetic fixture cleanup completed.
- Shared full verification follows A20's response-shape correction. Alternate
  weighting and completion-denominator policies remain ASK.

### A17 — patched client tooling and vulnerable transitives

- Updated Vite to 8.3.3, Vitest/mocker/spy to 5.0.3, source-map-js to 1.2.2
  and Zod to 4.6.7. Direct dependency ranges retain the existing caret style.
- User delegated the two required non-patch transitive choices; retained
  @oxc-project/types 0.150.0→0.156.0 (pinned by Rolldown 1.2.16) and
  why-is-node-running 2.3.0→3.2.1 (pinned by Vitest). Lock review verifies exact
  exceptions, registry/integrity fields, unchanged retained-package licenses,
  and only siginfo/stackback removals. Saved npm audit reports **0 vulnerabilities**.
- `fix-a17/lock-review` executed no check (stdin was not forwarded); its empty
  exit-0 output is not verification. `lock-review-executed` failed the original
  blanket patch-only assertion; `lock-review-approved` actually passes the
  reviewed scope. All outputs remain retained.
- Shared `fix-reporting-checkpoint/`: lint and separate production build pass;
  client **233/233**, server **149/six integration skips**, core **57/57**, all
  **35** PGlite migrations/sanity checks pass. Initial parallel client run had
  two timeouts; one-worker rerun passes with unchanged timeouts. Initial server
  run exposed an incorrect A20 shape expectation, corrected in that fix.
- These lint/build outputs precede A25–A35 UI edits; fresh UI verification follows.
  Lockfile review is metadata/scope verification, not a full dependency-source audit.

### A20 — preserve dimension-specific answers in results

- Results preserve/merge quality and quantity comments using the existing
  effective-cell/latest-non-null rules. Missing value/comment properties count
  as unanswered. Three retained builder-to-dashboard regressions previously fail;
  now pass in the **233/233** client run, including zero, both comment dimensions,
  missing properties, shadowing and merge behavior.
- Real HTTP-to-helper check `fix-a20/after-http.*` passes A18/A19/A20 together:
  [8,2,2] average **4**, count **3**; blank/quantity-only cells leave quality
  completion at **33%** on both bases. Synthetic fixture cleanup completed.
- Server/core shape assertions now include comments. Initial server expectation
  incorrectly discarded the fixture's `"absent"` comment; corrected expectation
  retains it. Original failed run is preserved. Full server **149/six skips**,
  core **57/57**, PGlite, lint/build and client checks pass at the A17 checkpoint.
  Completion-denominator and broader aggregation policies remain ASK.
