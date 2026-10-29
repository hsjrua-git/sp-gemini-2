import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openDatabase } from './isolated.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../runtime/browser-scoring-fixture.json', import.meta.url), 'utf8'));
const db = openDatabase();
try {
  assert.equal(fixture.cleaned, true);
  const viewer = (await db.query('SELECT role_id FROM users WHERE id=$1', [fixture.viewer.id])).rows[0];
  assert.equal(viewer.role_id, fixture.viewer.role_id);
  assert.equal((await db.query('SELECT id FROM roles WHERE id=$1', [fixture.roleId])).rowCount, 0);
  assert.equal((await db.query('SELECT id FROM evaluations WHERE session_id=ANY($1::uuid[])', [fixture.sessions])).rowCount, 0);
  const checks = [
    ['sessions', fixture.sessions, 'archived_at'],
    ['assignments', [fixture.assignmentId], 'archived_at'],
    ['parameters', [fixture.parameterId], 'archived_at'],
    ['student_groups', [fixture.groupId], 'archived_at'],
    ['students', fixture.students, 'deleted_at'],
  ];
  for (const [table, ids, column] of checks) {
    // Identifiers are fixed above; values are parameters. SELECT-only verification.
    const result = await db.query(`SELECT id, ${column} IS NOT NULL AS inactive FROM ${table} WHERE id=ANY($1::uuid[])`, [ids]);
    assert.equal(result.rowCount, ids.length, table);
    assert.ok(result.rows.every(row => row.inactive), table);
  }
  console.log(JSON.stringify({ fixture: fixture.name, viewerRestored: true, blindRoleAbsent: true,
    remainingEvaluationRows: 0, inactiveCounts: Object.fromEntries(checks.map(([table, ids]) => [table, ids.length])) }));
} finally {
  await db.end();
}
