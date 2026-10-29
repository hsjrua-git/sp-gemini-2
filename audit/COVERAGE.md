# Stage 1 coverage reconciliation

Baseline `a4d81f07d2e016341310dc8df79b9c878cf32ada`.
`continuation-12/coverage-reconcile.{txt,json}` is the executed read-only check;
`checks/coverage-reconcile.mjs` retains the exact classification and assertions.
The original inventory and its hashes were preserved, not regenerated.

## Source reads

- **499 files / 74,842 inventory text lines** recorded fully read.
- All **461 tracked text files**, including every application source/test,
  migration, deployment script, configuration, locale and documentation file.
- Also includes the three supplied schema references, two previously recorded
  untracked source/config files, and **32** newly read native Android text files.
- Long-line SVG reads were completed by wrapped, lossless text display. Their
  original hashes, not the wrapped presentation, were recorded.
- **629 non-secret files** still match their original SHA-256 values; no missing
  inventory file or new tracked path. Neither secret configuration was opened.
- The inventory's line count uses `split('\n').length`; a trailing newline or
  empty marker therefore contributes a line. It is not a physical `wc -l` count.

## Remaining 132 inventory entries

These remain **not fully read** in the original inventory. Their exact paths are
listed in the reconciliation output; no generated file was promoted to reviewed
merely because its authored source passed tests.

| Files | Scope / actual examination |
|---:|---|
| 92 | Copied Android web bundle, including minified application/vendor code and copied fonts. Hash comparison only; no decompilation or device/build provenance claim. |
| 33 | Other binary images/fonts and Gradle wrapper JAR. Hash comparison only; no binary-code audit. |
| 3 | npm lockfiles. Structured check of all 518 dependency records, root manifest ranges, registry HTTPS resolutions and integrity metadata; no anomalous resolution/integrity entries. Agent lockfile was also fully displayed (zero dependencies). Client/server lockfiles were not manually read line by line. |
| 2 | Pre-existing runtime logs, outside source-review scope; hash comparison only. |
| 2 | `server/.env` and `agent/.env`, intentionally unopened. |

The initial inventory already omitted `.git`, dependency directories, desktop web
build output and audit-generated evidence. No assertion is made about external
data or third-party source. Dependency advisory/reachability findings are in
`DEPENDENCY_ASSESSMENT.md`; this metadata check is not a supply-chain all-clear.

## Workflow coverage and retained boundaries

| Area | Executed local coverage | Remaining boundary |
|---|---|---|
| Authentication/permissions/privacy | Real multi-session password/change/reset/deactivate checks; role derivation; blind read refusals; archived restricted-field matrix; both manager-race interleavings | No universal permission proof; permissive assertions in the existing integration suite are explicitly rated WEAK |
| Scores/periods/results | Real preview/save/no-op/atomicity/lock/override/group inheritance/period allocation/readback; actual sighted-group UI save; blind UI failure reproduced | Individual/blind successful UI entry blocked by A21; native override prompt unsupported by host; cross-session aggregation/denominator policy ASK |
| Imports/exports | Student import HTTP classification/commit; real score CSV parser/preview failure; workbook generation plus UI download independently validated; actual CSV/SVG/PNG/chart controls | Score CSV confirmation blocked by A22; partial-import semantics ASK; no spreadsheet-application interoperability |
| Cafe/accounting | Real purchase → overdraft sale → void and independent ledgers/reports; actual journal draft → post → void; zero-price/fractional/refund probes; rollback close/reopen/opening/report invariants | A12 cash-refund semantics ASK; A27 non-POS mutation invalidations remain source-only extensions; no concurrent sustained load |
| Scheduling/groups | Real generation idempotence; Add → Remove → Re-add → Remove; session Archive → Unarchive; quick Cancel and assignment Restore refusals plus Edit error control | Adjacent teacher/interval/template/alert error paths are source-only A36 extensions; calendar component cases backed by real SQL, not clock-shifted browser |
| Browser/navigation/preferences | 30 protected routes, narrow Persian/RTL; native menu keyboard regression; language/theme save and reload; native route-heading focus controls | 480×597 latest viewport; desktop unavailable; pointer hit-testing unverified; first route-focus observation inconclusive; no reduced-motion emulation |
| Operations/agent | Actual backup/restore and failure rollback; path-retention defect; installer wrong-target reproduction; agent confirmation/malformed-host/fallback/provider probes | Real microphone/audio/model providers, device/emulator, Windows execution and storage-exhaustion/interruption untested; provider budgets and void protocol ASK |

All **65 existing test files** have individual ratings in `TEST_QUALITY.md`.
The audit's known failing regressions are separate from the passing project
suites; passing totals do not supersede any finding.
