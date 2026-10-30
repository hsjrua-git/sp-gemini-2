// Run only against a disposable, seeded database and its matching API.
// DATABASE_URL=... TEST_SERVER_URL=... node src/scripts/workflowSmoke.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pool from '../db/pool.js';
import { parseSessionPlan, planSessions, applySessionPlan } from '../lib/sessionPlan.js';
import { SAMPLE_PASSWORD } from './sampleModules.js';

const url = new URL(process.env.DATABASE_URL);
assert.match(url.pathname, /_(checks|test)$/u, 'Use a disposable _checks or _test database');
const base = process.env.TEST_SERVER_URL;
assert.ok(base, 'Set TEST_SERVER_URL to the API serving that database');
const suffix = randomUUID().slice(0, 8);
let checks = 0;
const passed = label => { checks++; console.log(`PASS ${label}`); };
async function session(username) {
  const cookies = new Map();
  const call = async (path, method = 'GET', body, status = 200) => {
    const response = await fetch(`${base}/api${path}`, { method, headers: {
      'Content-Type': 'application/json', Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(cookies.has('csrf') ? { 'X-CSRF-Token': cookies.get('csrf') } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const line of response.headers.getSetCookie()) {
      const [key, ...value] = line.split(';')[0].split('='); cookies.set(key, value.join('='));
    }
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  await call('/auth/login', 'POST', { username, password: SAMPLE_PASSWORD });
  return call;
}

async function databaseChecks() {
  const db = await pool.connect();
  const rejects = async (sql, values) => {
    await db.query('SAVEPOINT invalid_write');
    await assert.rejects(db.query(sql, values), error => error.code === '23514');
    await db.query('ROLLBACK TO SAVEPOINT invalid_write');
  };
  try {
    await db.query('BEGIN');
    const group = (await db.query('INSERT INTO student_groups (name, code) VALUES ($1, $1) RETURNING id', [`Workflow ${suffix}`])).rows[0].id;
    const interval = (await db.query("INSERT INTO intervals (name, every) VALUES ($1, interval '1 day') RETURNING id", [`Workflow ${suffix}`])).rows[0].id;
    const assignment = (await db.query(`INSERT INTO assignments (code, teacher_id, interval_id, group_id, anchor_date)
      SELECT $1, teacher_id, $2, $3, '2026-01-01' FROM assignments WHERE archived_at IS NULL LIMIT 1 RETURNING id`,
    [`WF-${suffix}`, interval, group])).rows[0].id;
    const plan = fields => planSessions(db, parseSessionPlan({ assignmentId: assignment, ...fields }).value);
    const far = await plan({ mode: 'sessions', count: 2, from: '2050-01-01' });
    assert.equal(far.rows[0].plannedDate, '2050-01-01');
    assert.ok(far.rows[0].seq > 1000);
    assert.ok(far.rows[0].code.endsWith(String(far.rows[0].seq)));
    passed('far-future start seeks directly and preserves long sequence codes');
    const exact = await plan({ mode: 'date', until: '2028-09-26' });
    assert.equal(exact.count, 1000);
    assert.equal((await plan({ mode: 'date', until: '2028-09-27' })).code, 'SESSION_PLAN_LIMIT');
    passed('date previews accept exactly 1000 and reject 1001 sessions');
    const periods = await plan({ mode: 'periods', count: 2 });
    assert.equal(periods.count, 8);
    assert.equal(await applySessionPlan(db, periods.rows), 8);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM periods WHERE assignment_id = $1', [assignment])).rows[0].n, 0);
    passed('two planned periods create eight sessions without answered periods');
    await db.query("UPDATE intervals SET every = interval '1 month' WHERE id = $1", [interval]);
    await db.query("UPDATE assignments SET anchor_date = '2024-01-31' WHERE id = $1", [assignment]);
    const monthly = await plan({ mode: 'sessions', count: 2, from: '2050-02-01' });
    assert.deepEqual(monthly.rows.map(row => row.plannedDate), ['2050-02-28', '2050-03-31']);
    passed('monthly previews preserve month-end anchors after a distant start');
    const parameters = (await db.query(`INSERT INTO parameters (code, name, min_value, max_value)
      VALUES ($1, $1, 2, 8), ($2, $2, 2, 8) RETURNING id`, [`WF-P-${suffix}`, `WF-C-${suffix}`])).rows;
    await db.query('UPDATE parameters SET parent_id = $1 WHERE id = $2', [parameters[0].id, parameters[1].id]);
    await rejects('UPDATE parameters SET parent_id = $1 WHERE id = $2', [parameters[1].id, parameters[0].id]);
    await rejects('UPDATE parameters SET archived_at = now() WHERE id = $1', [parameters[0].id]);
    passed('parameter cycles and archiving a parent with active children are refused');
    const sessionId = (await db.query('SELECT id FROM sessions WHERE assignment_id = $1 ORDER BY seq LIMIT 1', [assignment])).rows[0].id;
    await db.query(`INSERT INTO evaluations (session_id, parameter_id, quality_value, quantity_value, locks_at)
      VALUES ($1, $2, 100, 8, now() + interval '1 day')`, [sessionId, parameters[0].id]);
    await rejects('UPDATE evaluations SET quality_value = 101 WHERE session_id = $1', [sessionId]);
    await rejects('UPDATE evaluations SET quality_value = -1 WHERE session_id = $1', [sessionId]);
    await rejects('UPDATE evaluations SET quantity_value = 9 WHERE session_id = $1', [sessionId]);
    await db.query('UPDATE evaluations SET quality_value = 0 WHERE session_id = $1', [sessionId]);
    passed('quality accepts 0/100 independently of quantity bounds and rejects overflow');
  } finally { await db.query('ROLLBACK'); db.release(); }
}

async function apiChecks() {
  const admin = await session('sample-admin');
  const staff = await session('sample-staff');
  const viewer = await session('sample-viewer');
  const assignments = (await admin('/assignments')).assignments;
  const assignment = assignments.find(a => a.groupId);
  const body = { assignmentId: assignment.id, mode: 'sessions', count: 2 };
  await admin('/sessions/generate', 'POST', body, 409);
  const preview = await admin('/sessions/generate', 'POST', { ...body, dryRun: true });
  const concurrent = await Promise.allSettled([0, 1].map(() => admin('/sessions/generate', 'POST', { ...body, previewToken: preview.token }, 201)));
  assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(concurrent.find(r => r.status === 'rejected').reason.message, /SESSION_PLAN_STALE/);
  passed('generation requires preview and concurrent confirmation creates only once');
  const sessions = (await admin(`/sessions?assignmentId=${assignment.id}`)).sessions;
  for (const row of preview.rows) assert.ok(sessions.some(s => s.seq === row.seq && s.plannedDate === row.plannedDate && s.code === row.code));
  passed('committed session dates and codes exactly match the preview');
  const active = sessions.filter(s => !s.archivedAt && !s.canceledAt).slice(0, 2);
  const template = (await admin('/task-templates', 'POST', { title: `Workflow ${suffix}`, checklist: [{ label: 'First' }, { label: 'Second' }] }, 201)).template;
  const targets = active.map(s => ({ sessionId: s.id, membershipId: null }));
  await admin('/tasks/from-template', 'POST', { templateId: template.id, targets: [...targets, { sessionId: randomUUID() }] }, 400);
  assert.equal((await admin(`/tasks?sessionId=${active[0].id}`)).tasks.filter(t => t.templateId === template.id).length, 0);
  assert.equal((await admin('/tasks/from-template', 'POST', { templateId: template.id, targets }, 201)).created, 2);
  const task = (await admin(`/tasks?sessionId=${active[0].id}`)).tasks.find(t => t.templateId === template.id);
  const other = (await admin(`/tasks?sessionId=${active[1].id}`)).tasks.find(t => t.templateId === template.id);
  passed('multi-target assignment rolls back entirely on one invalid target');
  await admin(`/task-templates/${template.id}`, 'PATCH', { checklist: [{ label: 'Changed definition' }] });
  await Promise.all(task.checklist.map(item => staff(`/tasks/${task.id}/progress`, 'PATCH', { itemId: item.id, done: true, note: item.label })));
  const completed = (await viewer(`/tasks?sessionId=${active[0].id}`)).tasks.find(t => t.id === task.id);
  assert.equal(completed.done, true);
  assert.ok(completed.doneAt);
  assert.deepEqual(completed.checklist.map(i => i.label), ['First', 'Second']);
  assert.ok(completed.checklist.every(i => i.done && i.doneAt && i.note === i.label));
  assert.equal((await admin(`/tasks?sessionId=${active[1].id}`)).tasks.find(t => t.id === other.id).done, false);
  await viewer(`/tasks/${task.id}/progress`, 'PATCH', { done: false }, 403);
  await staff(`/tasks/${task.id}`, 'PATCH', { title: 'Forbidden' }, 403);
  passed('checklist snapshots are independent; concurrent evaluator progress is retained; viewer cannot mutate');
  const periodIds = (await admin('/periods')).periods.map(p => p.id);
  const query = new URLSearchParams({ periodIds: periodIds.join(',') });
  const report = await admin(`/results/scope?${query}`);
  const cube = await admin(`/export/cube?${query}`);
  let cells = 0;
  for (const grid of report.grids) {
    for (const row of grid.rows.filter(r => !r.isGroup)) {
      assert.ok(cube.periodStudents[`${grid.assignment.id}:${grid.period.seq}`].includes(row.studentId));
      for (const [parameterId, cell] of Object.entries(row.cells)) {
        const exported = cube.cells.find(c => c.studentId === row.studentId && c.assignmentId === grid.assignment.id && c.periodSeq === grid.period.seq && c.parameterId === parameterId);
        assert.ok(exported);
        for (const dim of ['quality', 'quantity']) {
          assert.equal(exported[dim], cell[dim]);
          assert.equal(exported.previous?.[dim] ?? null, row.previous[parameterId]?.[dim] ?? null);
        }
        cells++;
      }
    }
  }
  assert.ok(cells > 100);
  passed(`scoped Results and Export agree for ${cells} cells, both dimensions and previous values`);
  for (const call of [admin, staff, viewer]) await call('/auth/logout', 'POST', undefined, 204);
}

try { await databaseChecks(); await apiChecks(); console.log(`Workflow smoke: ${checks} checks passed`); }
finally { await pool.end(); }
