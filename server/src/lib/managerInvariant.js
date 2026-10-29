// All HTTP role/assignment/activation writers take this lock immediately after
// BEGIN, before row locks or permission reads. Per-role/user locks alone cannot
// protect the invariant spanning users AND role_permissions. Keep the lock in
// its own statement so subsequent READ COMMITTED queries see the previous writer.
export async function lockManagerInvariant(db) {
  await db.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    ['student-panel:active-manager-invariant']
  );
}
