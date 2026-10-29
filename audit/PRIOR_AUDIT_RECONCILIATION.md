# Prior-audit reconciliation at `a4d81f0`

Date: 2026-10-29. Sources are the local files at baseline
`a4d81f07d2e016341310dc8df79b9c878cf32ada`. All referenced historical reports
were fully read. Their test counts, screenshots and completion statements are
historical evidence, not executions by this audit. They remain unchanged.

**Conclusion:** many repairs are present, but blanket completion is unsupported.
In particular, `docs/audit-notes.md` #3's missing group inheritance and #8's raw
trend weighting reproduce as A18/A19. New probes also establish failures outside
the narrower cases covered by earlier repairs. Current Stage 1 remains incomplete.

Interpretation:

- **Executed:** this audit has retained an execution relevant to the stated case.
- **Source:** a repair or difference is established by current source; this does
  not claim every original reproduction was rerun successfully.
- **Open/partial:** a current probe reproduces a defect, or policy/coverage remains
  unresolved. A passed related smoke does not close an entire compound finding.

## `docs/audit-notes.md` — main findings 1–27

| Prior item | Current disposition and evidence boundary |
|---|---|
| 1. Date/interval serialization and chronological sorting | **Repair present; representative execution.** `server/src/db/pool.js:6` registers OID 1082; `db/pglite.js:87-94` registers date/interval parsers. Retained `baseline/verify-pglite.txt:49-50` executes their contracts; the real scoring workflow returns usable session dates. This is not an independent recreation of all 11 page/date cases or every partial fiscal PATCH. |
| 2. Dashboard mutation object called as a function | **Source repair.** `client/src/pages/DashboardPage.jsx:114` calls `update.mutate`. The old function/object mismatch is absent. Current dashboard correctness still has A18–A20 and an unresolved completion-denominator policy. |
| 3. Multi-session ordering, fallback, group statistics | **Partial/open.** `routes/results.js:127` orders sessions and `lib/results.js` merges non-null values. `client/src/lib/resultsView.js:222-236` excludes `isGroup` rows from statistics. But actual results omit two inherited member scores in the [8,2,2] cohort (A18). Broad cross-session aggregation and tie/shadow policy are not declared resolved; those policy changes remain ASK. |
| 4. Score roles lack schedule context | **Superseded repair strategy; partial workflow.** Migration 033 restores minimal assignment/session context instead of granting broad `schedule.view`. `continuation-01/scoring-workflow.txt` exercises blind context/save and denied score/export reads. A21 blocks the actual blind/individual React grid, and A14 exposes locked-score equality through writes. Backend context access is not sufficient evidence of usable blind entry. |
| 5. Closed-period and system-entry void | **Repair present; executed guard coverage.** Migrations 031/032 and journal engine enforce closed-period/system-entry rules; PGlite verifier and serial accounting smoke pass their retained checks. A09 concerns kiosk confirmation, a separate boundary. |
| 6. Contra-balance/large closing entry ignored errors | **Source repair.** `lib/accountingJournal.js:465-500` reverses contra signs, passes `maxLines: Infinity`, and returns `closing.error` before marking closed. The 9-check accounting smoke does not by itself prove every >100-line/contra variant. |
| 7. Closed-period errors become 500 | **Source repair.** Central handler `server/src/index.js:481-500` translates post/void closed-period errors to 409/`ACCOUNTING_PERIOD_CLOSED`. Every cafe mutation/opening route variant has not been independently rerun for this case. |
| 8. Raw group weighting and group filter drops individuals | **Partial/open.** `routes/dashboard.js:37-40,100-103` now includes individual assignments through membership. `:48` still averages raw evaluations: real average 5/count 2 instead of effective average 4/count 3 (A19). Core service source shares the raw aggregation; that is not a separate core execution. |
| 9. Agent state, failures, model protocol, names/dates/status | **Source repairs, additional open defects.** Current dialogue/tool/LLM code includes cancel publication, sale error/finally handling, mutation invalidation, empty-name guard, Tehran date and tool-call IDs. Existing 21 unit tests pass historically. These do not protect concurrent confirms (A03), staged/negated undo (A09), malformed Host (A08), or missing-mic fallback (A16). Real speech/model providers remain untested. |
| 10. Audit categories | **Source repair.** `server/src/lib/auditCategories.js` maps inventory/accounting prefixes; route/core consumers use the shared definitions. Full per-action browser rendering is not established. |
| 11. Archived balances included in financial totals | **Prior proposed fix superseded.** Excluding archived debt would erase a real obligation. Current totals intentionally include all balances, with archival/balance guards added by migration 031 and student/cafe transactions. Do not restore the earlier exclusion. A12 is an independently executed refund-direction divergence. |
| 12. Reset removes chart/mappings; no initial fiscal period | **Partial correction / policy.** `server/src/scripts/resetData.js:101-120` restores system chart/mappings; PGlite reset verification passes. No default fiscal period is reseeded. An empty fiscal calendar is not automatically a defect: opening dates/calendar policy must be agreed. The report's historical file names and some initial-period claims disagree with actual migrations. |
| 13. Offline mirror lacks newer modules | **Product boundary changed.** Current docs/HTTP client implement a connected Capacitor companion, not a full offline app. Core is a test mirror and still has independent drift risk. No native device/APK execution is claimed here. |
| 14. Alerts ignore answers; task deletion timestamp | **Source repair and retained smoke.** `lib/alerts.js` now calls `session_is_complete`; task DELETE at `routes/tasks.js:293-307` updates its session. Migration 035 synchronizes answer/inactivation alerts. `baseline/smoke-alerts` passes six checks. Task deletion and timestamp bump use separate pool calls, so the older report's “inside a transaction” wording is not a current source fact. No new failure of that pair has been executed. |
| 15. Opening audit omission/dead audit rules | **Source repair.** Opening route records the event; current audit rules exclude in-route recorded operations. Do not infer opening audit execution merely from an accounting smoke. |
| 16. Year/string intervals | **Source/parser repair.** PGlite normalization is executed in the retained verifier; Schedule normalizes years/string intervals. Full UI next-occurrence behavior for every interval is not rerun. |
| 17. Cafe/accounting action translations | **Source repair; coverage limited.** Current locale catalogues/shared categories include these domains. Parity tests compare structure, not translation quality or every emitted detail. |
| 18. Custom date fields/cache invalidation | **Source repair.** `StudentFieldsSection.jsx:17-18,40-41` formats date values and invalidates detail and list. A07 is a separate archived-definition privacy leak. |
| 19. Mobile group-filter overflow | **Narrow execution only.** Current 454 px route sweep detected no horizontal overflow. It does not recreate the original 390 px long-name fixture. |
| 20. Student submit precedes custom fields | **Source repair.** `StudentForm.jsx:63-83` places submit below nonempty custom definitions. |
| 21. Past-members keys use student ID | **Source repair and narrow live workflow verified.** `client/src/pages/GroupsPage.jsx:106` uses `membershipId` with a composite fallback. Actual Add → Remove → Re-add → Remove gives two distinct membership IDs and two past-member DOM rows for the same student/date pair; four PUTs return 200 and independent readbacks pass. See `continuation-06/browser-groups.md`; synthetic entities archived. |
| 22. Balance integer input/table layout | **Source repair present.** Shared whole-money parsing and table wrapper are in the reviewed balance component. Browser invalid-input/receipt workflow remains to be covered. A12/A13 concern different server contracts. |
| 23. Orphaned pre-Vitest tests | **Removed in current inventory.** The active test ledger covers 65 existing automated files; no deletion is performed by this audit. |
| 24. Backup/restore and sample removal | **Partial/executed.** Actual scripts round-trip 40 table fingerprints, refuse invalid gzip and roll back deliberate SQL failure (`continuation-01/backup-restore-roundtrip`). Retention still deletes an unrelated spaced-path sentinel (A01). This audit has not rerun a complete post-finance sample removal in the working evidence database. |
| 25. Heading/subtitle overlap | **Narrow rendering evidence only.** Route sweep without overflow is not a pixel-level overlap regression. Desktop typography verification remains pending. |
| 26. Avatar/preferences/spacing/placeholders/code formatting/THREE warning | **Mixed; not blanket-closed.** Existing narrow route logs contain no captured error-level messages, which does not exclude warning-level deprecations. Full CSS/component review and focused visual matrix remain pending. A15 is an independently executed drawer-focus failure. |
| 27. Documentation/test-count drift | **Historical counts superseded.** Use this audit's saved command metadata, not historical totals. Current README's Accountant close/chart promise also differs from migration 026's view/enter/post role; changing seeded permissions requires a policy decision. |

The preserved appendix repeats earlier findings with inconsistent counts/table
names and, in places, contradicts the main report about fiscal-period seeding.
It supplies historical context, not another independent proof or current schema.

## `docs/audit-remediation-report.md`

Accurate source repairs include parser registration, mutation invocation, some
ordering/null preservation, system-entry guards, contra close handling, audit
categories, custom-field rendering, and transactional restore. Several details
are superseded or overstate the actual repair:

- Lines 17 and 73–80 do not establish complete effective-member score handling;
  A18 reproduces missing group fallback. A19's weighting was not repaired by the
  individual-assignment filter described at lines 81–82.
- Broad `schedule.view` prerequisites (lines 25/109–110) were deliberately
  reversed by migration 033. Minimal context access is the current design.
- Excluding archived balances (lines 22/96/105–106) was deliberately reversed
  to preserve financial obligations, with archival guards instead.
- Some cited paths are historical/nonexistent (for example
  `server/src/lib/resetData.js` and newer core services). Use current inventory,
  not this file list, to infer implementation coverage.
- Agent exception safety and state publication do not serialize simultaneous
  confirms; A03 demonstrates the remaining race.
- Basic atomic backups/transactional restores do not establish safe retention;
  A01 remains reproducible.
- The report explicitly lacked real PostgreSQL integration. Its green suites
  cannot establish the cross-transaction properties that required later repairs.

## `docs/audit-2026-10-28-sp-gemini-1-opencode.md` — findings 1–18

This report audits `9835dd0`; its later final-disposition section describes the
baseline now under review. The following reconciles that disposition rather
than assuming its conclusions transfer to every related workflow.

| Prior item | Current evidence |
|---|---|
| 1. Fiscal/range/opening/re-close concurrency | Migrations 031/032 add the named invariant repairs. Retained real two-connection smoke passes five checks; PGlite verifier covers opening/system-entry guards. Different manager concurrency invariant remains broken (A02). |
| 2. Closing erases income statement | Current report SQL excludes system closing lines; retained serial accounting smoke passes. Full browser close/reopen/report workflow remains pending. |
| 3. Unsafe bigint conversion | Central safe-money conversion and tests are present; prior large-number issue is addressed at source. Decimal quantity validation (A13), waste rounding (A10), zero-total student sales (A11), and cash refunds (A12) show that broader money correctness is not complete. |
| 4. Root public harness/artifacts | The current tracked project uses the three package entrypoints; historical root bootstrap is absent. This audit's isolated harness is under ignored/local `audit/`, and no publication/deployment has occurred. |
| 5. Hierarchy races | Migration 032 and retained five-check real invariant smoke cover group/account cycles. No all-concurrency claim follows. |
| 6. Archived student financial lifecycle | Source guards and all-balance totals replace the earlier exclusion policy. Broader HTTP/browser lifecycle still needs independent exercise. |
| 7. Accounting route permissions | Route-specific guards are present. Existing permission suite has weak allowed-status assertions; use exact status/body checks in continued finance workflows. |
| 8. Restricted audit snapshots | `routes/audit.js:90-99` loads restricted definitions including archived and recursively redacts snapshots. A07 shows that student responses use a different, defective active-only filter. Broader current privacy execution remains pending. |
| 9. Constellation scope/defaults/completion | Controls/source changes are present; A18–A20 and the measured denominator discrepancy prevent a general completion claim. |
| 10. Mobile/offline mismatch | Connected companion is the documented current scope. Native APK/device verification remains a gap; example assertion A06 is incorrect by source. |
| 11. Env/setup/version floors | Package-local templates/scripts are restored. This audit uses pinned isolation, not normal `.env` startup, and has not executed the full installer/minimum-version matrix. |
| 12. Blind-entry least privilege | Minimal context approach is present; real reads/redaction pass scoped checks. A14 defeats locked-score confidentiality and A21 blocks the grid. |
| 13. Smoke/test hygiene | Retained smokes run successfully when serial; original concurrent accounting failure is harness interference. Test weaknesses remain documented in `TEST_QUALITY.md`; green tests do not establish all workflows. |
| 14. Logging/transcripts/reset/privacy boundaries | Source contains query-string-safe logging, private transcript modes, explicit provider boundaries and transcript reset. Real external-provider and deployment behavior is not claimed. |
| 15. Preloading/focus/accessibility | On-demand route source and headings are present. A15 reproduces mobile drawer focus escape. Route-level focus, drawer focus and screen-reader announcements are separate checks. |
| 16. Schema/error/health hardening | Migrations/handler source contain repairs; `/api/health` actually reports database OK on port 3300. Source reads alone do not prove every lifecycle, and deployment grants undermine append-only protection (A24). |
| 17. Dead code/localization/docs | Many retired concepts were removed, and baseline locale/error coverage passes. Remaining full-file review and policy inconsistencies prevent blanket documentation closure. |
| 18. Backup/repository recovery | Current restore/round-trip probes pass; retention A01 fails. Compatible development dependency advisories are recorded as A17, not inferred from older production-only scans. |

## `FINDINGS.md`

This is a shipped-fix changelog. Its line 7 assertion that all confirmed
critical-through-minor findings are remediated is too broad for the current
evidence. Lines 171–172 promise selected-cell completion, while the client uses
roster × in-use parameters; the measured discrepancy is an ASK policy item.
Lines 201–202 promise blind entry without score reads, but A14 and A21 establish
confidentiality/usability failures within that supported mode.

Historical successful tours and test counts are retained, not relabeled as
fraudulent or replaced. They simply did not exercise the failing cases recorded
by this audit. Stage 2 will update only authorized fixes with before/after
regressions; it has not started.
