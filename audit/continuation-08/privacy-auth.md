# Isolated privacy/auth matrix

`privacy-auth-matrix-02.{txt,json}` records **25 passing / 3 failing assertion
groups**, exit 1. All requests use the real isolated API on port 3300 and direct
SELECT verification pins PostgreSQL `student_panel_audit` on port 55439. Real
schema/constraints/indexes were inspected in `privacy-schema.{txt,json}`. The
Postgres MCP still points at unrelated port 5432 and was used only to check identity.

## Established behavior

- Active restricted field: student detail, list and PATCH response hide its value
  from a disposable role with student read/create/edit and audit access, but no
  `fields.view_restricted`. A public field stays visible.
- Archiving the restricted definition leaks its stored value through all three
  response surfaces (**A07**, now also confirmed for mutation responses).
- Restoring that definition makes all three surfaces private again. Unauthorized
  writes to the restricted field are rejected in each phase, and SELECT readback
  shows both stored markers preserved. Nonrestricted creation succeeds.
- Audit response redaction passes while the field is active, archived and restored.
  These assertions locate the exact persisted `student.create` audit row **356**,
  establish that the admin response contains the restricted marker, then establish
  that the limited reader's response contains the row/public marker but neither
  private marker nor private field ID. Secret-like request keys are `[hidden]`
  in storage. This is not an empty-result privacy assertion.
- New-user password-change gating denies both reads and writes. Changing the
  password retains the caller's session and evicts a second established session
  (database session count 2 → 1; second `/auth/me` returns 401).
- Changing the role removes write access from the existing session on its next
  request. Administrator password reset evicts both sessions (2 → 0) and requires
  another password change. Deactivation also evicts both sessions (2 → 0).
- Actual generated credentials are absent from persisted auth/create/reset audit
  details. Credentials are held in memory and are not written to evidence.

## Cleanup and limits

Two synthetic students and two field definitions were archived; the synthetic
user is inactive with zero sessions; its retained custom role has zero permissions.
SELECT assertions establish every cleanup condition, and the runtime fixture has
`cleaned:true`. Audit history remains intact. This is an HTTP/database matrix,
not browser privacy UI, exhaustive attack coverage or a concurrency auth test.

The initial `privacy-auth-matrix` run stopped on a **probe error**: the assertion
looked for `details.body` rather than the inspected `details.request` envelope.
Its cleanup passed. Original output is retained; this failure is not a product
finding. The corrected run uses new fixtures and a separate evidence stem.
