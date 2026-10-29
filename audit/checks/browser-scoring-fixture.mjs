import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { api, login, openDatabase } from './isolated.mjs';

// Durable fixture identity allows cleanup even across a browser/harness restart.
// Only synthetic entities and the disposable sample-viewer's role are changed.
const file = new URL('../runtime/browser-scoring-fixture.json', import.meta.url);
const mode = process.argv[2];
assert.ok(['prepare', 'individual', 'blind', 'sighted', 'archive-target', 'readback', 'cleanup'].includes(mode));
const db = openDatabase();
const admin = api();
let fixture;
const persist = () => fs.writeFile(file, JSON.stringify(fixture, null, 2));
async function request(path, method = 'GET', body, status = 200) {
  const result = await admin(path, { method, body });
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}
try {
  await login(admin);
  if (mode === 'prepare') {
    const old = await fs.readFile(file, 'utf8').then(JSON.parse).catch(e => { if (e.code !== 'ENOENT') throw e; });
    assert.ok(!old || old.cleaned, 'clean previous fixture first');
    fixture = { name: `Audit UI ${randomBytes(5).toString('hex')}`, students: [], sessions: [], cleaned: false };
    fixture.viewer = (await db.query("SELECT id, role_id FROM users WHERE username='sample-viewer'")).rows[0];
    assert.ok(fixture.viewer);
    await persist();
    for (const suffix of ['One', 'Two']) {
      const student = await request('/api/students', 'POST', { fullName: `${fixture.name} ${suffix}` }, 201);
      fixture.students.push(student.id);
      await persist();
    }
    fixture.groupId = (await request('/api/groups', 'POST', { name: fixture.name }, 201)).group.id;
    await persist();
    await request(`/api/groups/${fixture.groupId}/members`, 'PUT', { add: fixture.students });
    const timing = (await db.query(`SELECT id, current_date::text AS today,
      (current_date + every)::date::text AS until, (current_date - 30)::text AS past
      FROM intervals WHERE archived_at IS NULL ORDER BY every LIMIT 1`)).rows[0];
    const teacher = (await db.query('SELECT id FROM teachers WHERE archived_at IS NULL ORDER BY id LIMIT 1')).rows[0];
    fixture.assignmentId = (await request('/api/assignments', 'POST', {
      name: fixture.name, groupId: fixture.groupId, teacherId: teacher.id,
      intervalId: timing.id, anchorDate: timing.today,
    }, 201)).assignment.id;
    await persist();
    fixture.parameterId = (await request('/api/parameters', 'POST', {
      name: fixture.name, code: `ui-${randomBytes(5).toString('hex')}`, minValue: 0, maxValue: 9,
    }, 201)).id;
    await persist();
    await request('/api/sessions/generate', 'POST', { assignmentId: fixture.assignmentId, until: timing.until }, 201);
    fixture.sessions = (await request(`/api/sessions?assignmentId=${fixture.assignmentId}`)).sessions.map(s => s.id);
    assert.equal(fixture.sessions.length, 2);
    await persist();
    await request(`/api/sessions/${fixture.sessions[1]}`, 'PATCH', { movedTo: timing.past });
    await request('/api/evaluations/bulk', 'PUT', { sessionId: fixture.sessions[1], entries: [{
      membershipId: null, parameterId: fixture.parameterId, selected: true,
      qualityValue: 2, quantityValue: 3, qualityComment: 'Audit locked fixture', quantityComment: null,
    }] });
    fixture.roleId = (await request('/api/roles', 'POST', { name: `${fixture.name} blind`, permissions: ['scores.enter'] }, 201)).role.id;
    await persist();
    console.log(JSON.stringify(fixture, null, 2));
  } else {
    fixture = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(fixture.cleaned, false);
    if (mode === 'individual') {
      assert.ok(!fixture.individualAssignmentId);
      const base = (await request('/api/assignments')).assignments.find(a => a.id === fixture.assignmentId);
      const member = (await request(`/api/groups/${fixture.groupId}/members`)).students.find(s => s.id === fixture.students[0]);
      fixture.individualAssignmentId = (await request('/api/assignments', 'POST', {
        name: `${fixture.name} individual`, membershipId: member.membershipId,
        teacherId: base.teacherId, intervalId: base.intervalId, anchorDate: base.anchorDate,
      }, 201)).assignment.id;
      await persist();
      await request('/api/sessions/generate', 'POST', { assignmentId: fixture.individualAssignmentId, until: base.anchorDate }, 201);
      const sessions = (await request(`/api/sessions?assignmentId=${fixture.individualAssignmentId}`)).sessions;
      fixture.sessions.push(...sessions.map(s => s.id));
      await persist();
      console.log(JSON.stringify({ assignmentId: fixture.individualAssignmentId, sessions }));
    } else if (mode === 'blind' || mode === 'sighted') {
      await db.query('UPDATE users SET role_id=$1 WHERE id=$2', [mode === 'blind' ? fixture.roleId : fixture.viewer.role_id, fixture.viewer.id]);
      console.log(`Disposable sample-viewer role ${mode === 'blind' ? 'set to blind fixture' : 'restored'}.`);
    } else if (mode === 'archive-target') {
      await request(`/api/assignments/${fixture.assignmentId}`, 'DELETE', undefined, 204);
      await request(`/api/groups/${fixture.groupId}`, 'DELETE', undefined, 204);
      console.log(JSON.stringify({ assignmentId: fixture.assignmentId, groupId: fixture.groupId, archived: true }));
    } else if (mode === 'readback') {
      for (const id of fixture.sessions) {
        console.log(JSON.stringify({ sessionId: id, ...(await request(`/api/evaluations?sessionId=${id}`)) }));
      }
    } else {
      await db.query('UPDATE users SET role_id=$1 WHERE id=$2', [fixture.viewer.role_id, fixture.viewer.id]);
      const roles = (await request('/api/roles')).roles;
      if (roles.some(role => role.id === fixture.roleId)) {
        await request(`/api/roles/${fixture.roleId}`, 'DELETE', undefined, 204);
      }
      // A36 archives the target, which also archives its sessions. Restore only
      // this durable synthetic fixture before removing its selected cells.
      if (fixture.groupId) await request(`/api/groups/${fixture.groupId}`, 'PATCH', { archived: false });
      for (const id of [fixture.assignmentId, fixture.individualAssignmentId].filter(Boolean)) {
        await request(`/api/assignments/${id}`, 'PATCH', { archived: false });
      }
      for (const id of fixture.sessions) {
        await request(`/api/sessions/${id}`, 'PATCH', { archived: false });
        const rows = (await request(`/api/evaluations?sessionId=${id}`)).evaluations;
        if (rows.length) await request('/api/evaluations/bulk', 'PUT', { sessionId: id,
          overrideReason: 'Audit browser fixture cleanup', entries: rows.map(r => ({
            membershipId: r.membershipId, parameterId: r.parameterId, selected: false,
            qualityValue: null, quantityValue: null, qualityComment: null, quantityComment: null,
          })),
        });
        await request(`/api/sessions/${id}`, 'PATCH', { archived: true });
      }
      if (fixture.assignmentId) await request(`/api/assignments/${fixture.assignmentId}`, 'DELETE', undefined, 204);
      if (fixture.individualAssignmentId) await request(`/api/assignments/${fixture.individualAssignmentId}`, 'DELETE', undefined, 204);
      if (fixture.parameterId) await request(`/api/parameters/${fixture.parameterId}`, 'PATCH', { archived: true });
      if (fixture.groupId) await request(`/api/groups/${fixture.groupId}`, 'DELETE', undefined, 204);
      for (const id of fixture.students) await request(`/api/students/${id}`, 'DELETE', undefined, 204);
      fixture.cleaned = true;
      await persist();
      console.log('Cleanup complete: viewer restored; fixture scores removed and entities archived.');
    }
  }
} finally {
  await admin('/api/auth/logout', { method: 'POST' }).catch(() => {});
  await db.end();
}
