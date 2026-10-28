// recordAudit writes one audit_log row. Beyond the action/details envelope it
// can carry ROW SNAPSHOTS (schema-4's old_data/new_data): `oldData` is the
// row state before the change (null/omitted on insert), `newData` after it
// (null/omitted on delete). Snapshots are jsonb columns next to `details`,
// which keeps carrying the human-readable per-change summary.
export async function recordAudit(
  db,
  {
    userId = null,
    actor,
    action,
    entityType = null,
    entityId = null,
    details = {},
    oldData = undefined,
    newData = undefined,
  }
) {
  await db.query(
    `INSERT INTO audit_log
       (user_id, actor, action, entity_type, entity_id, details, old_data, new_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      actor,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
      oldData === undefined ? null : JSON.stringify(oldData),
      newData === undefined ? null : JSON.stringify(newData),
    ]
  );
}
