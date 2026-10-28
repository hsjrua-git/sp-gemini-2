// Helpers for the group tree. Membership is stored as direct links only, so
// filtering by a group means "this group and everything under it". These
// functions compute that closure with recursive CTEs.

// Every group id at or below `rootId` (includes rootId itself). Archived
// groups are included by id so their members still resolve when filtering.
export async function descendantGroupIds(db, rootId) {
  const result = await db.query(
    `WITH RECURSIVE tree AS (
       SELECT id FROM student_groups WHERE id = $1
       UNION ALL
       SELECT g.id
       FROM student_groups g
       JOIN tree ON g.parent_id = tree.id
     )
     SELECT id FROM tree`,
    [rootId]
  );
  return result.rows.map((row) => row.id);
}

// Ancestor ids of `groupId`, walking up to the root (excludes groupId itself).
// Used to reject a move that would make a group its own ancestor (a cycle).
export async function ancestorGroupIds(db, groupId) {
  const result = await db.query(
    `WITH RECURSIVE up AS (
       SELECT parent_id FROM student_groups WHERE id = $1
       UNION ALL
       SELECT g.parent_id
       FROM student_groups g
       JOIN up ON g.id = up.parent_id
       WHERE up.parent_id IS NOT NULL
     )
     SELECT parent_id AS id FROM up WHERE parent_id IS NOT NULL`,
    [groupId]
  );
  return result.rows.map((row) => row.id);
}

// The distinct student ids that belong to a group or any of its descendants.
export async function studentIdsInGroupTree(db, rootId) {
  const result = await db.query(
    `WITH RECURSIVE tree AS (
       SELECT id FROM student_groups WHERE id = $1
       UNION ALL
       SELECT g.id
       FROM student_groups g
       JOIN tree ON g.parent_id = tree.id
     )
     SELECT DISTINCT m.student_id AS "studentId"
     FROM student_group_members m
     JOIN tree ON m.group_id = tree.id
     WHERE m.left_on IS NULL`,
    [rootId]
  );
  return result.rows.map((row) => row.studentId);
}
