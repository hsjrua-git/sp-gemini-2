import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import { api, login, openDatabase } from './isolated.mjs';

// Run serially against the isolated sample fixture. All business writes go
// through HTTP; only the disposable blind-role assignment uses direct SQL.
// `oracle` adds the blind locked-cell privacy regression after workflow controls.
const mode = process.argv[2] ?? 'workflow';
assert.ok(['workflow', 'oracle'].includes(mode));
const evidencePhase = process.argv[3] ?? 'runtime';
assert.match(evidencePhase, /^[\w-]+$/);
const admin = api();
const blind = api();
const db = openDatabase();
const students = [];
const sessions = [];
let groupId, assignmentId, parameterId, blindRoleId, originalViewer;
const checks = [];
async function ok(call, path, options, status = 200) {
  const response = await call(path, options);
  assert.equal(response.status, status, `${path}: ${JSON.stringify(response.data)}`);
  return response.data;
}
const a = (path, options, status) => ok(admin, path, options, status);
const bulk = (call, sessionId, entries, extra = {}) => call('/api/evaluations/bulk', {
  method: 'PUT', body: { sessionId, entries, ...extra },
});
const cell = (changes = {}) => ({ membershipId: null, parameterId, selected: true,
  qualityValue: null, quantityValue: null, qualityComment: null, quantityComment: null, ...changes });
const readCells = async sessionId => (await a(`/api/evaluations?sessionId=${sessionId}`)).evaluations;
const readPeriods = async () => (await a(`/api/periods?assignmentId=${assignmentId}`)).periods;
const auditRows = async sessionId => (await db.query(
  `SELECT id::text, details, old_data, new_data FROM audit_log
   WHERE action = 'scores.save' AND entity_id = $1 ORDER BY id`, [sessionId],
)).rows;
function passed(label) { checks.push(label); console.log(`PASS ${label}`); }

try {
  await login(admin);
  const suffix = randomUUID().slice(0, 12);
  const prefix = `Audit scoring ${suffix}`;
  const importRows = [
    { row: 1, fullName: `${prefix} One` }, { row: 2, fullName: `${prefix} Two` },
    { row: 3, fullName: `  ${prefix} One  ` }, { row: 4, fullName: 'x' },
  ];
  const previewImport = await a('/api/students/import', { method: 'POST', body: { rows: importRows, dryRun: true } });
  assert.deepEqual(previewImport.counts, { total: 4, willImport: 2, invalid: 1, duplicates: 1, skipped: 2 });
  assert.equal((await a(`/api/students?search=${encodeURIComponent(prefix)}`)).total, 0);
  const imported = await a('/api/students/import', { method: 'POST', body: { rows: importRows } }, 201);
  students.push(...imported.created);
  assert.equal(students.length, 2);
  assert.equal(new Set(students.map(student => student.studentCode)).size, 2);
  assert.ok(students.every(student => /^[2-9A-HJ-NP-Z]{8}$/.test(student.studentCode)));
  const repeatImport = await a('/api/students/import', { method: 'POST', body: { rows: importRows, dryRun: true } });
  assert.equal(repeatImport.counts.willImport, 0);
  passed('student import dry-run, duplicate/invalid classification, commit, repeat preview');

  groupId = (await a('/api/groups', { method: 'POST', body: { name: prefix } }, 201)).group.id;
  assert.equal((await a(`/api/groups/${groupId}/members`, { method: 'PUT', body: { add: students.map(s => s.id) } })).added, 2);
  const membershipId = (await a(`/api/groups/${groupId}/members`)).students.find(s => s.id === students[0].id).membershipId;
  const timing = (await db.query(
    `SELECT id, current_date::text AS today, (current_date + 5 * every)::date::text AS until,
            (current_date - 30)::text AS old_date
     FROM intervals WHERE archived_at IS NULL ORDER BY every LIMIT 1`,
  )).rows[0];
  const teacherId = (await db.query('SELECT id FROM teachers WHERE archived_at IS NULL ORDER BY id LIMIT 1')).rows[0]?.id;
  assert.ok(timing && teacherId, 'requires isolated sample teacher/interval');
  assignmentId = (await a('/api/assignments', { method: 'POST', body: {
    name: prefix, groupId, teacherId, intervalId: timing.id, anchorDate: timing.today,
  } }, 201)).assignment.id;
  parameterId = (await a('/api/parameters', { method: 'POST', body: {
    code: `audit-${suffix}`, name: prefix, minValue: 0, maxValue: 9,
  } }, 201)).id;
  assert.equal((await a('/api/sessions/generate', { method: 'POST', body: { assignmentId, until: timing.until } }, 201)).created, 6);
  assert.equal((await a('/api/sessions/generate', { method: 'POST', body: { assignmentId, until: timing.until } }, 201)).created, 0);
  sessions.push(...(await a(`/api/sessions?assignmentId=${assignmentId}`)).sessions);
  assert.equal(sessions.length, 6);
  assert.deepEqual(await readPeriods(), []);
  const first = sessions[0].id;
  passed('six real generated sessions; repeated generation is a no-op; no premature periods');

  const blank = cell();
  const blankPreview = await bulk(admin, first, [blank], { dryRun: true });
  assert.equal(blankPreview.status, 200);
  assert.equal(blankPreview.data.counts.new, 1);
  assert.deepEqual(await readCells(first), []);
  assert.equal((await bulk(admin, first, [blank])).data.changed, 1);
  assert.deepEqual(await readPeriods(), []);
  const answered = cell({ qualityValue: 2, quantityValue: 3 });
  const changePreview = await bulk(admin, first, [answered], { dryRun: true });
  assert.equal(changePreview.status, 200);
  assert.equal(changePreview.data.counts.change, 1);
  assert.equal((await readCells(first))[0].qualityValue, null);
  assert.equal((await bulk(admin, first, [answered])).data.changed, 1);
  assert.equal((await readPeriods())[0].sessionCount, 1);
  passed('score preview is read-only; selected-empty consumes no period; answer attaches session');

  const beforeNoop = await readCells(first);
  const beforeAudit = await auditRows(first);
  const noop = await bulk(admin, first, [answered]);
  assert.equal(noop.status, 200);
  assert.equal(noop.data.changed, 0);
  assert.deepEqual(await readCells(first), beforeNoop);
  assert.deepEqual(await auditRows(first), beforeAudit);
  const invalid = await bulk(admin, first, [cell({ qualityValue: 4 }), cell({ parameterId: randomUUID() })]);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.code, 'EVALUATIONS_INVALID_ENTRIES');
  assert.deepEqual(await readCells(first), beforeNoop);
  passed('unchanged save preserves timestamps/audit; mixed invalid batch writes nothing');

  const individual = cell({ membershipId, qualityValue: 8, quantityValue: 6 });
  const scoreImport = await bulk(admin, first, [individual], { source: 'import' });
  assert.equal(scoreImport.status, 200);
  assert.equal(scoreImport.data.changed, 1);
  assert.equal((await auditRows(first)).at(-1).details.source, 'import');
  for (const session of sessions.slice(1, 5)) {
    const result = await bulk(admin, session.id, [answered]);
    assert.equal(result.status, 200);
    assert.equal(result.data.changed, 1);
  }
  assert.deepEqual((await readPeriods()).map(period => period.sessionCount), [4, 1]);
  const filter = { assignmentId, studentIds: students.map(s => s.id), parameterIds: [parameterId] };
  const cube = await a('/api/export/cube', { method: 'POST', body: filter });
  assert.equal(cube.cells.length, 10);
  const firstCells = cube.cells.filter(c => c.sessionSeq === sessions[0].seq);
  assert.equal(firstCells.find(c => c.studentId === students[0].id).quality, 8);
  assert.equal(firstCells.find(c => c.studentId === students[0].id).viaGroup, false);
  assert.equal(firstCells.find(c => c.studentId === students[1].id).quality, 2);
  assert.equal(firstCells.find(c => c.studentId === students[1].id).viaGroup, true);
  const getQuery = new URLSearchParams({ assignmentId, studentIds: filter.studentIds.join(','), parameterIds: parameterId });
  assert.deepEqual(await a(`/api/export/cube?${getQuery}`), cube);
  await fs.writeFile(new URL(`../${evidencePhase}/scoring-cube-${mode}.json`, import.meta.url), JSON.stringify(cube, null, 2), { flag: 'wx' });
  passed('import-tagged score save; five answered sessions become 4+1; GET/POST cube agrees and own scores shadow group');

  blindRoleId = (await a('/api/roles', { method: 'POST', body: {
    name: `Audit blind ${suffix}`, permissions: ['scores.enter'],
  } }, 201)).role.id;
  originalViewer = (await db.query("SELECT id, role_id FROM users WHERE username = 'sample-viewer'")).rows[0];
  assert.ok(originalViewer);
  await db.query('UPDATE users SET role_id = $1 WHERE id = $2', [blindRoleId, originalViewer.id]);
  const user = await login(blind, 'sample-viewer');
  assert.ok(user.permissions.includes('scores.enter'));
  assert.ok(!user.permissions.includes('scores.view') && !user.permissions.includes('scores.override'));
  assert.equal((await blind(`/api/evaluations?sessionId=${first}`)).status, 403);
  assert.equal((await blind(`/api/export/cube?assignmentId=${assignmentId}`)).status, 403);
  const blindPreview = await bulk(blind, first, [answered], { dryRun: true });
  assert.equal(blindPreview.status, 200);
  assert.equal(blindPreview.data.redacted, true);
  assert.equal(blindPreview.data.cells[0].from, null);
  assert.equal(blindPreview.data.cells[0].status, 'save');
  passed('blind entry cannot GET scores/export and its unlocked preview is redacted');

  const lockedSession = sessions[5].id;
  await a(`/api/sessions/${lockedSession}`, { method: 'PATCH', body: { movedTo: timing.old_date } });
  const originalValue = randomInt(0, 10);
  assert.equal((await bulk(admin, lockedSession, [cell({ qualityValue: originalValue })])).status, 200);
  assert.equal((await readCells(lockedSession))[0].isLocked, true);
  const replacement = (originalValue + 1) % 10;
  const changed = cell({ qualityValue: replacement });
  const denied = await bulk(blind, lockedSession, [changed]);
  assert.equal(denied.status, 409);
  assert.equal(denied.data.code, 'LOCKED');
  const reasonRequired = await bulk(admin, lockedSession, [changed]);
  assert.equal(reasonRequired.status, 400);
  assert.equal(reasonRequired.data.code, 'OVERRIDE_REASON_REQUIRED');
  const overrideReason = 'Audit approved correction';
  const override = await bulk(admin, lockedSession, [changed], { overrideReason });
  assert.equal(override.status, 200);
  assert.equal(override.data.changed, 1);
  assert.equal((await readCells(lockedSession))[0].qualityValue, replacement);
  assert.equal((await auditRows(lockedSession)).at(-1).details.overrideReason, overrideReason);
  const lockedPreview = await bulk(blind, lockedSession, [cell()], { dryRun: true });
  assert.equal(lockedPreview.status, 200);
  assert.equal(lockedPreview.data.cells[0].status, 'locked');
  assert.equal(lockedPreview.data.cells[0].from, null);
  assert.equal(Object.hasOwn(lockedPreview.data.cells[0], 'lockedAt'), false);
  passed('locked changes refused; override requires reason, saves and audits; locked blind preview redacted');

  if (mode === 'oracle') {
    const before = await readCells(lockedSession);
    const audits = await auditRows(lockedSession);
    const sightedNoop = await bulk(admin, lockedSession, [cell({ qualityValue: replacement })]);
    assert.equal(sightedNoop.status, 200);
    assert.equal(sightedNoop.data.changed, 0);
    const guesses = [];
    for (let guess = 0; guess <= 9; guess++) {
      const preview = await bulk(blind, lockedSession, [cell({ qualityValue: guess })], { dryRun: true });
      assert.equal(preview.status, 200);
      assert.equal(preview.data.redacted, true);
      assert.equal(preview.data.cells[0].from, null);
      assert.equal(preview.data.cells[0].status, 'locked');
      assert.equal(Object.hasOwn(preview.data.cells[0], 'lockedAt'), false);
      const result = await bulk(blind, lockedSession, [cell({ qualityValue: guess })]);
      guesses.push({ guess, status: result.status, code: result.data.code, changed: result.data.changed });
    }
    const recovered = guesses.filter(guess => guess.status === 200 && guess.changed === 0);
    assert.deepEqual(await readCells(lockedSession), before, 'oracle must not alter any score or timestamp');
    assert.deepEqual(await auditRows(lockedSession), audits, 'oracle writes no score audit');
    console.log(JSON.stringify({ guesses, recoveredValue: recovered[0]?.guess, actualValue: replacement,
      recoveredExactly: recovered.length === 1 && recovered[0].guess === replacement,
      scoresAndAuditUnchanged: true }, null, 2));
    assert.equal(recovered.length, 0, 'a blind writer must not recover locked scores by distinguishing a correct guess');
    assert.ok(guesses.every(guess => guess.status === 409 && guess.code === 'LOCKED'), 'every guess has the same lock response');
  }
  console.log(JSON.stringify({ mode, passedChecks: checks.length, checks }));
} finally {
  if (originalViewer) await db.query('UPDATE users SET role_id = $1 WHERE id = $2', [originalViewer.role_id, originalViewer.id]);
  await blind('/api/auth/logout', { method: 'POST' }).catch(() => {});
  if (blindRoleId) await a(`/api/roles/${blindRoleId}`, { method: 'DELETE' }, 204);
  for (const session of sessions) {
    const existing = await readCells(session.id);
    if (existing.length) {
      const result = await bulk(admin, session.id, existing.map(row => cell({
        membershipId: row.membershipId, parameterId: row.parameterId, selected: false,
      })), { overrideReason: 'Audit fixture cleanup' });
      assert.equal(result.status, 200, 'clean up only synthetic scores through authorized override');
    }
    await a(`/api/sessions/${session.id}`, { method: 'PATCH', body: { archived: true } });
  }
  if (assignmentId) await a(`/api/assignments/${assignmentId}`, { method: 'DELETE' }, 204);
  if (parameterId) await a(`/api/parameters/${parameterId}`, { method: 'PATCH', body: { archived: true } });
  if (groupId) await a(`/api/groups/${groupId}`, { method: 'DELETE' }, 204);
  for (const student of students) await a(`/api/students/${student.id}`, { method: 'DELETE' }, 204);
  await admin('/api/auth/logout', { method: 'POST' });
  await db.end();
  console.log('Cleanup: synthetic scores removed; entities archived; viewer role restored.');
}
