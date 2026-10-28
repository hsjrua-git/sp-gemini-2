# Schema 4 adaptation map

Compared 2026-10-28 against the maintainer references:

- `schema-4.dbml` — SHA-256 `fa56b47cf0f0a182fcd7c38c9897de52648dc1c075b11b8c1cf23f13238bee60`
- `schema-4.sql` — SHA-256 `3d8921d69c8dbb31a90af007b665f57cfdeb6d125725819c693545cd9969f73a`
- `schema-4-security.sql` — SHA-256 `65ec8102f962b52521df3c4ee91c4f78ca83cea1e393f4fb26434f0537ec7666`

The application adopted schema 4 incrementally on top of its existing users,
roles, sessions, audit, cafe, and accounting database. It intentionally does
not rename all tables or replace those modules with the standalone reference.

## Deliberate application-specific differences

| Reference | Application adaptation |
| --- | --- |
| Singular table names | Existing plural names retained. |
| Required student demographics | Optional identity fields retained for incremental enrollment. |
| Membership `joined_on date` | Existing `added_at timestamptz` retained; guards compare its calendar date to the session date. |
| Parameter name is identity | Stable `parameters.code` added; sibling names may repeat. |
| One evaluation comment | Separate quality and quantity comments. |
| `locked_at` flag | `locks_at` deadline (7-day/current, 1-day/past policy). |
| Session owns `period_id` after first answer | Applied directly: database triggers attach/detach/reactivate answered active sessions, four per assignment period. |
| Global single preference row | Per-user `user_preferences`. |
| Generic DB-trigger audit table | Existing actor/category HTTP audit with row snapshots. |
| One `session_incomplete` enum | Existing extensible text kind `session_unconfirmed`, now using selected-cell completion semantics. |
| No auth/cafe/accounting tables | Existing application modules retained and hardened by later migrations. |

## Reference guarantees now applied

- Membership date check and one open membership per student/group.
- Assignment target exclusivity and stable codes/names.
- Unique session identity and immutable assignment/sequence/code/planned date.
- One evaluation cell per session/parameter/target (`NULLS NOT DISTINCT`).
- Evaluation target belongs to the assignment and is active on session date.
- New, restored, or edited active evaluations cannot target archived/canceled
  sessions, archived assignments/parameters/groups, or deleted students;
  archiving a session may retain untouched evaluation history.
- Individual assignments reject whole-group evaluation rows.
- Archived evaluations cannot be edited until restored.
- Locked updates/deletes require transaction-local `app.override_reason`.
- Session cancellation is blocked while active cells exist; archiving is
  historical, detaches the session, and retains its cells for restoration.
- Quality/quantity ranges and concurrent range narrowing are DB-enforced.
- Task membership/parameter references are active and assignment-valid.
- Selected-cell completion helpers and `session_missing_parameters` view.
- Persisted `sessions.period_id`, `period_summary`, `period_analysis`, and
  `session_status`, with serialized first-answer attachment and inactive/final-
  answer detachment.
- Open-alert uniqueness; overdue incomplete sessions remain actionable and
  completion/inactivation resolves them without a scanner race.
- Secret value XOR/check constraints and explicit deployment grant template.
- Hierarchy, fiscal-period, opening-entry, closed-book and ledger invariants in
  migrations 031–035.

## Migration ownership

Migrations 001–030 remain historical and unchanged. Forward migrations are the
only supported update path:

- **031** runtime/accounting/FK invariants and schema-4 cleanup.
- **032** serialized group/account hierarchy and system-entry immutability.
- **033** restore blind score-role least privilege.
- **034** remaining adapted schema-4 session/evaluation/task guards and helpers.
- **035** authoritative answered-session period lifecycle, analysis/status
  views, and race-safe alert synchronization.

`deploy/postgres-roles.example.sql` adapts the supplied security template to the
actual application tables and excludes password/session/secret tables from the
read-only role. Role creation remains an operator deployment step, not an app
migration, because passwords and owner names must never be committed.
