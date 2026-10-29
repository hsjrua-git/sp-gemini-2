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

## Stage 2 workflow updates

The preceding table records Stage 1. A21/A22 retries at the separate production
preview `127.0.0.1:5300` now pass: individual sighted save, group-member blind
save, individual blind save with existing values hidden, and actual CSV upload →
preview → confirmation. Independent Administrator reads confirm the submitted
values; fixture cleanup is independently verified. See `fix-a21/browser.md` and
`fix-a22/browser.md`. The current observed desktop viewport is **1233×887**;
this supersedes “desktop unavailable” for these workflows only, not a desktop
route sweep. Native locked override and pointer hit-testing retain their
documented harness limits. Baseline source hashes remain historical after fixes.

## Stage 2 closeout — 2026-10-30

`FIX_LOG.md` records all 32 AUTO dispositions, their local commits, exact executed
checks and four deferred ASK findings. This section supersedes only the earlier
workflow limitations explicitly retried below; Stage 1 counts/ratings remain
historical. No additional source was relabeled fully read by test success.

| Retried workflow | Executed result |
|---|---|
| Individual/blind score entry and CSV confirmation | A21/A22 successful browser saves, independent readbacks and cleanup |
| Persian numeric score entry | **۷/۶ → 7/6**, HTTP 200/changed 1; actual checkbox/Save clicks succeed |
| POS quote, student debit and void | **15 quoted/charged**, balance −15 then 0, stock restored to 1; independent ledger/journal/cleanup checks |
| Scheduling quick refusals | Actual 409/400 now display translated explanations; bilingual component retry clearing passes |
| Export period scope | Actual selected-period CSV **15 rows**; all-calendar CSV **30 rows**, independently compared |
| Chart images and period controls | Actual plotted SVG/PNG downloads under unchanged production CSP; default/explicit distributions nonempty; heatmap **64→44→64** matches selected period |
| Mobile menu | **528×887** Persian/RTL native keys pass opening, both Tab wraps, containment, panel changes, Escape and inertness |

Latest client lint/build/**233 tests**, server **149/six skips**, agent **37**,
core **57**, PGlite **35 migrations**, and separate serial HTTP integration **6**
plus real ledger/invariant smokes pass. Component-only findings and adjacent
source-only extensions are identified individually in `FIX_LOG.md`; they are not
described as live browser tests. Actual download-byte validation is retained.

The completed desktop-width retries (1233×887) and narrow-menu/export checks
(528×887) do not constitute a new all-route responsive sweep. Pointer activation
is now established for the exercised scoring/POS/export controls. Native locked
override, real providers/devices, real installer authentication, spreadsheet
interoperability and sustained-load assurance remain unverified. A06's ignored
native template correction is retained as a patch; native regeneration may undo it.

Read-only `stage2-final-local/preservation.*` checks **629 non-secret files**:
**570 unchanged**, **59 expected fix differences**, no missing/unexplained files;
inventory bytes and **295 original baseline/continuation/Stage 1 evidence files**
match the Stage 1 commit. All supplied schema hashes remain unchanged. Existing
generated/binary/log/lockfile source-review boundaries above still apply.
