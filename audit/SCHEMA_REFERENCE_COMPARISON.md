# Supplied schema/security reference comparison

Baseline: `a4d81f07d2e016341310dc8df79b9c878cf32ada`; 2026-10-29.
The three supplied `partly-schema/` files were fully read and remain untouched.
Their SHA-256 values match `docs/schema-4-adaptation.md:5-7` exactly:

| File | SHA-256 |
|---|---|
| `schema-4.sql` | `3d8921d69c8dbb31a90af007b665f57cfdeb6d125725819c693545cd9969f73a` |
| `schema-4.dbml` | `fa56b47cf0f0a182fcd7c38c9897de52648dc1c075b11b8c1cf23f13238bee60` |
| `schema-4-security.sql` | `65ec8102f962b52521df3c4ee91c4f78ca83cea1e393f4fb26434f0537ec7666` |

## Intentional adaptations, not defects

The reference is a standalone academic schema. The application retains plural
table names and its auth, permissions, custom fields, cafe, accounting and agent
modules. It also keeps optional identity fields, timestamp membership joins,
stable parameter codes, separate quality/quantity comments, per-user preferences,
and deadline-based `locks_at` rather than a manually set `locked_at` flag.
These differences are explicitly identified in the adaptation document.

The reference's single-comment “answered” condition must therefore map to either
nonempty application comment (or either value). Table-name equality is not a
meaningful compatibility test. The SQL reference supplies executable constraints;
DBML supplies the model description, not evidence those constraints run in the app.

## Guarantee-by-guarantee evidence

| Reference guarantee | Application and evidence boundary |
|---|---|
| One selected cell per session/parameter/target; nullable group target | Migration 029 uses `NULLS NOT DISTINCT` uniqueness. Real workflow saves group/member rows and export resolves a member override. A18 shows results does not implement the same effective fallback. |
| Empty selected cell is an expectation, not an answer | Migration 034 `evaluation_is_answered`; migration 035 `session_is_complete`. Real workflow and PGlite verifier execute selected-empty/no-period and first-answer attachment. The client comment-aware completion contract still fails (A20). |
| Four answered active sessions per assignment period | Migration 035 persists `sessions.period_id`; real five-answer workflow produces 4+1. PGlite exercises archive detach/restore. Not every concurrent attach/detach or historical migration permutation is independently exercised here. |
| Active session/assignment/parameter and dated membership | Migrations 034/035 implement guards; PGlite has representative refusal checks. Export uses session-date membership. A18 repair must preserve dates rather than copy a period-wide group value into every row. |
| Individual assignment cannot receive whole-group evaluation | Representative PGlite refusal passes; real individual API behavior is supported. Actual individual browser entry is blocked by A21 before editing. |
| Archived evaluations are history; locked changes require reason | Migration 034 checks archived edits and transaction-local `app.override_reason`. HTTP workflow executes lock refusal, reasoned override, no-op/nonmutation and audit. Blind equality response leaks values (A14), a permission-boundary property absent from the standalone schema. |
| Session cancellation/identity invariants | Migrations 034/035 implement identity generation/immutability and active-cell cancellation refusal; PGlite executes representative cases. |
| Parameter ranges, hierarchy and tasks | Migrations 031/032/034 guard these; retained real invariant race smoke passes five checks and PGlite checks invalid task target. Coverage is limited to those assertions. |
| Status/summary/analysis views and alert synchronization | Migration 035 creates `session_status`, `period_summary`, `period_analysis`, and replaces missing-parameter view/completion helpers; six-check alert smoke passes. API/client report agreement is not guaranteed by those views (A18–A20). |
| Generic trigger audit, append-only history | **Intentional audit producer adaptation plus security gap.** The app records actor/category HTTP events/snapshots instead of generic `audit_row()` triggers. The reference also blocks audit UPDATE/DELETE (`schema-4.sql:431-440`) and revokes those privileges (`schema-4-security.sql:38-41`). The app has neither equivalent audit mutation trigger nor restricted runtime grants; A24 is executed below. Direct SQL mutations are not automatically captured by HTTP middleware. |
| Secret value XOR and reporting role exclusion | Current schema has secret constraints; deployment template excludes `users`, `user_sessions`, `secrets` from the reporting role. These are source-established grant choices, not a survey of any real installation's roles. Future-object default grants need an explicit sensitive-table policy. |

## Executed deployment-template difference (A24)

`deploy/postgres-roles.example.sql:20-25` grants the runtime role SELECT/INSERT/
UPDATE/DELETE/**TRUNCATE** on every current public table. Unlike the supplied
security template, it never narrows `audit_log` to SELECT/INSERT. Its future table
defaults also include UPDATE/DELETE. The isolated schema has a stock BEFORE
UPDATE/DELETE trigger, but no stock TRUNCATE trigger and no audit mutation trigger.

`checks/deployment-ledger-grants.mjs` executes the **unchanged template** with
new roles inside one transaction on port 55439. It then switches to the new
non-superuser, non-owner application role:

- One existing audit row can be rewritten and deleted.
- Stock DELETE is refused with `P0001` (negative control).
- Stock TRUNCATE succeeds and takes 19 retained movement rows to zero.
- Final ROLLBACK restores exact audit/stock fingerprints and every captured
  public table/function/schema/default ACL; temporary roles are absent afterward.

Evidence: `continuation-05/deployment-ledger-grants.{txt,json}` (intended
contract assertion fails, exit 1). No actual deployment was changed. This is a
database-role containment failure given runtime SQL/credential access; no HTTP
injection or remote exploit was demonstrated.

**MEDIUM / VERIFIED / ASK.** An approved runtime-versus-maintenance role split
should remove audit UPDATE/DELETE and runtime ledger TRUNCATE while supporting
explicit reset/seed/restore maintenance under a separate role. Tightening grants
or adding immutable audit triggers changes operational policy and needs approval.

Inspection note: `continuation-05/grant-schema` ends with exit 1 after valid
audit/stock/balance descriptions because the harness requested nonexistent
`acct_entries`. This was an inspection naming mistake, not a product failure.
`grant-schema-02` lists the actual `acct_journal_entries`/`acct_journal_lines`
names and confirms the relevant triggers. No accounting mutation was attempted.
Postgres MCP was rechecked: it still targets unrelated port 5432, so all probe
inspection and writes used the agreed pinned isolated fallback.

## Unresolved policy and migration questions

- `docs/schema-4-adaptation.md:46` and `FINDINGS.md:171-172` describe selected-cell
  completion. The current client intentionally tests a roster × in-use-parameter
  denominator. Real selected-one-of-three evidence returns client 33% versus
  summary 100%; choose a contract before broad denominator changes.
- Cross-session aggregation is an application decision beyond raw schema
  integrity. Preserve the existing contract in A18/A19 narrow repairs; alternate
  weighting/latest-value policies remain ASK.
- Migration 029 destructively replaces historical evaluation/period/view data.
  Its comment refers to approval; that approval and historical reconciliation
  cannot be established from the current checkout. No migration rewrite is authorized.
- Cash-refund versus sale-void credit semantics are application extensions.
  A12 needs a signed-ledger/schema and reconciliation decision, not literal
  adoption of the standalone academic reference.
- The role example is optional deployment SQL. Whether an existing installation
  used it, uses an owner login, or has additional grants is unverified.

This comparison is complete for the stated reference/adaptation questions. It
does not mark unread application files reviewed or close the Stage 1 workflow gate.
