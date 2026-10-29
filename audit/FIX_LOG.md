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
