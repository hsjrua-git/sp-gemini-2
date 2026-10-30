import assert from 'node:assert/strict';
import { login, request } from './release-api.mjs';

const mode = process.argv[2];
const health = await request('/api/health');
console.log('health', JSON.stringify(health));
if (mode === 'guarded') {
  assert.equal(health.status, 503);
  assert.equal(health.body.code, 'DATABASE_MIGRATIONS_PENDING');
  for (const path of ['/api/auth/me', '/api/task-templates', '/api/tasks?sessionId=00000000-0000-0000-0000-000000000000']) {
    const result = await request(path);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'DATABASE_MIGRATIONS_PENDING');
    console.log(path, JSON.stringify(result));
  }
} else {
  assert.equal(health.status, 200);
  await login();
  for (const path of ['/api/task-templates', '/api/tasks?sessionId=00000000-0000-0000-0000-000000000000']) {
    const result = await request(path);
    assert.equal(result.status, mode === 'repaired' ? 200 : 500);
    console.log(path, JSON.stringify({ status: result.status, ...(result.status >= 400 ? result.body : { ok: true }) }));
  }
}
