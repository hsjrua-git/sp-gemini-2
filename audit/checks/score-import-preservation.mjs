import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Papa from '../../client/node_modules/papaparse/papaparse.js';
import { prepareRows } from '../../client/src/lib/importNames.js';
import { buildImport, guessLayout, planImport } from '../../client/src/lib/scoreImport.js';
import { api, login, openDatabase } from './isolated.mjs';

// Real CSV parsing/planning -> real preview/save -> readback, bypassing only
// the already-reproduced React preview-render crash (A22). Run serially.
// Context7 did not resolve Papa Parse; official parse-string API consulted at
// https://www.papaparse.com/docs. All fixture writes use isolated HTTP endpoints.
const db = openDatabase();
const call = api();
let student, groupId, assignmentId, parameter, sessionId, membershipId;
async function ok(path, options, status = 200) {
  const response = await call(path, options);
  assert.equal(response.status, status, `${path}: ${JSON.stringify(response.data)}`);
  return response.data;
}
const bulk = (entries, extra = {}) => ok('/api/evaluations/bulk', {
  method: 'PUT', body: { sessionId, entries, ...extra },
});
const read = async () => (await ok(`/api/evaluations?sessionId=${sessionId}`)).evaluations;
const values = row => Object.fromEntries(['qualityValue', 'quantityValue', 'qualityComment',
  'quantityComment'].map(key => [key, row[key]]));
const observations = [];
try {
  await login(call);
  const suffix = randomUUID().slice(0, 10);
  const name = `Audit CSV preservation ${suffix}`;
  student = await ok('/api/students', { method: 'POST', body: { fullName: name } }, 201);
  // Student CRUD returns the resource directly; groups/assignments wrap it.
  assert.ok(student.id && student.studentCode);
  groupId = (await ok('/api/groups', { method: 'POST', body: { name } }, 201)).group.id;
  await ok(`/api/groups/${groupId}/members`, { method: 'PUT', body: { add: [student.id] } });
  membershipId = (await ok(`/api/groups/${groupId}/members`)).students[0].membershipId;
  const timing = (await db.query(`SELECT id, current_date::text AS today
    FROM intervals WHERE archived_at IS NULL ORDER BY every LIMIT 1`)).rows[0];
  const teacher = (await db.query('SELECT id FROM teachers WHERE archived_at IS NULL ORDER BY id LIMIT 1')).rows[0];
  assignmentId = (await ok('/api/assignments', { method: 'POST', body: {
    name, groupId, teacherId: teacher.id, intervalId: timing.id, anchorDate: timing.today,
  } }, 201)).assignment.id;
  parameter = await ok('/api/parameters', { method: 'POST', body: {
    name: `CSV Metric ${suffix}`, code: `audit-csv-${suffix}`, minValue: 0, maxValue: 100,
  } }, 201);
  await ok('/api/sessions/generate', { method: 'POST', body: { assignmentId, until: timing.today } }, 201);
  sessionId = (await ok(`/api/sessions?assignmentId=${assignmentId}`)).sessions[0].id;
  console.log(JSON.stringify({ fixture: { studentId: student.id, studentCode: student.studentCode,
    groupId, assignmentId, parameterId: parameter.id, sessionId } }));
  const original = { membershipId, parameterId: parameter.id, selected: true,
    qualityValue: 11, quantityValue: 22, qualityComment: 'Keep quality note', quantityComment: 'Keep quantity note' };
  const cases = [
    { name: 'entirely blank pair control', header: 'CSV Metric (quality),CSV Metric (quantity)', row: ',',
      expected: values(original), count: 0 },
    { name: 'quality-only mapped column', header: 'CSV Metric (quality)', row: '77',
      expected: { ...values(original), qualityValue: 77 }, count: 1 },
    { name: 'blank quantity column', header: 'CSV Metric (quality),CSV Metric (quantity)', row: '77,',
      expected: { ...values(original), qualityValue: 77 }, count: 1 },
    { name: 'quantity-only mapped column', header: 'CSV Metric (quantity)', row: '66',
      expected: { ...values(original), quantityValue: 66 }, count: 1 },
    { name: 'both values present, comments absent', header: 'CSV Metric (quality),CSV Metric (quantity)', row: '77,66',
      expected: { ...values(original), qualityValue: 77, quantityValue: 66 }, count: 1 },
  ];
  for (const item of cases) {
    await bulk([original]);
    const before = await read();
    assert.deepEqual(values(before[0]), values(original));
    const csv = `Student code,${item.header.replaceAll('CSV Metric', parameter.name)}\n${student.studentCode},${item.row}\n`;
    const parsed = Papa.parse(csv, { skipEmptyLines: false });
    // Like the page, retain Papa's comma fallback for tiny two-column files.
    // A delimiter-detection warning is not a failed CSV parse; verify the rows.
    assert.ok(parsed.errors.every(error => error.code === 'UndetectableDelimiter'));
    assert.equal(parsed.meta.delimiter, ',');
    const rows = prepareRows(parsed.data);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].cells[0], student.studentCode);
    const layout = guessLayout(rows[0].cells, [parameter]);
    const built = buildImport({ rows, hasHeader: true, ...layout, parameters: [parameter],
      studentsByCode: new Map([[student.studentCode, { ...student, membershipId }]]) });
    assert.equal(built.localProblemCount, 0);
    assert.equal(built.entries.length, item.count);
    let preview = null;
    if (built.entries.length) {
      preview = await bulk(built.entries, { dryRun: true });
      assert.deepEqual(preview.problems, []);
      assert.deepEqual(await read(), before, 'dry-run preserves the complete row and timestamp');
      const plan = planImport({ built, server: preview, canOverride: true });
      assert.equal(plan.send.length, 1);
      assert.equal((await bulk(plan.send, { source: 'import' })).changed, 1);
    }
    const after = await read();
    const actual = values(after[0]);
    const preserved = Object.keys(item.expected).every(key => actual[key] === item.expected[key]);
    const observation = { name: item.name, csv, parseWarnings: parsed.errors,
      entries: built.entries, before: values(before[0]),
      preview: preview?.cells ?? null, actual, expected: item.expected, preserved };
    observations.push(observation);
    console.log(JSON.stringify(observation, null, 2));
    if (!built.entries.length) assert.deepEqual(after, before, 'blank-pair control changes nothing');
  }
  assert.equal(observations.filter(item => !item.preserved).length, 0,
    'CSV imports must preserve blank/unmapped values and existing notes absent from the file');
} catch (error) {
  console.error('Probe failure before cleanup:', error);
  throw error;
} finally {
  if (sessionId) {
    const rows = await read();
    if (rows.length) await bulk(rows.map(row => ({ membershipId: row.membershipId,
      parameterId: row.parameterId, selected: false, qualityValue: null, quantityValue: null })),
    { overrideReason: 'Audit fixture cleanup' });
    await ok(`/api/sessions/${sessionId}`, { method: 'PATCH', body: { archived: true } });
  }
  if (assignmentId) await ok(`/api/assignments/${assignmentId}`, { method: 'DELETE' }, 204);
  if (parameter) await ok(`/api/parameters/${parameter.id}`, { method: 'PATCH', body: { archived: true } });
  if (groupId) await ok(`/api/groups/${groupId}`, { method: 'DELETE' }, 204);
  if (student) await ok(`/api/students/${student.id}`, { method: 'DELETE' }, 204);
  await call('/api/auth/logout', { method: 'POST' });
  await db.end();
  console.log('Cleanup: synthetic scores removed; fixture entities archived.');
}
