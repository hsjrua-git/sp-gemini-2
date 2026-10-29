import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { api, login } from './isolated.mjs';

const mode = process.argv[2];
assert.ok(['prepare', 'readback', 'cleanup'].includes(mode));
const file = new URL('../runtime/browser-group-fixture.json', import.meta.url);
const call = api();
let fixture;
const persist = () => fs.writeFile(file, JSON.stringify(fixture, null, 2));
async function request(path, method = 'GET', body, status = 200) {
  const result = await call(path, { method, body });
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}
try {
  await login(call);
  if (mode === 'prepare') {
    const old = await fs.readFile(file, 'utf8').then(JSON.parse).catch(e => { if (e.code !== 'ENOENT') throw e; });
    assert.ok(!old || old.cleaned);
    fixture = { name: `Audit Rejoin ${randomBytes(5).toString('hex')}`, cleaned: false };
    await persist();
    fixture.studentId = (await request('/api/students', 'POST', { fullName: fixture.name }, 201)).id;
    await persist();
    fixture.groupId = (await request('/api/groups', 'POST', { name: fixture.name }, 201)).group.id;
    await persist();
    console.log(JSON.stringify(fixture));
  } else {
    fixture = JSON.parse(await fs.readFile(file, 'utf8'));
    const members = (await request(`/api/groups/${fixture.groupId}/members`)).students;
    assert.ok(members.every(row => row.id === fixture.studentId));
    assert.equal(new Set(members.map(row => row.membershipId)).size, members.length);
    const open = members.filter(row => row.leftOn === null);
    if (mode === 'readback') {
      assert.equal(members.length, Number(process.argv[3]));
      assert.equal(open.length, Number(process.argv[4]));
      console.log(JSON.stringify({ fixture, members }, null, 2));
    } else {
      assert.equal(fixture.cleaned, false);
      if (open.length) await request(`/api/groups/${fixture.groupId}/members`, 'PUT', { remove: [fixture.studentId] });
      await request(`/api/groups/${fixture.groupId}`, 'DELETE', undefined, 204);
      await request(`/api/students/${fixture.studentId}`, 'DELETE', undefined, 204);
      assert.equal((await call(`/api/students/${fixture.studentId}`)).status, 404);
      const archived = (await request('/api/groups?includeArchived=1')).groups.find(row => row.id === fixture.groupId);
      assert.ok(archived.archivedAt);
      fixture.cleaned = true;
      await persist();
      console.log(JSON.stringify({ fixture: fixture.name, cleaned: true, distinctMemberships: members.length }));
    }
  }
} finally {
  await call('/api/auth/logout', { method: 'POST' }).catch(() => {});
}
