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
