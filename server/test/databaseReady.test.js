import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createDatabaseReadiness } from '../src/middleware/databaseReady.js';

test('health and API gate detect missing migrations before session work and recover after upgrade', async t => {
  let rows = [{ filename: '001.sql' }, { filename: '037.sql' }];
  let sessionCalls = 0;
  const ready = createDatabaseReadiness({ pool: { query: async () => ({ rows }) }, migrations: ['001.sql', '036.sql', '037.sql'] });
  const app = express();
  app.get('/api/health', ready.health);
  app.use('/api', ready.requireReady, (req, res) => { sessionCalls++; res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [path, method] of [['/api/health', 'GET'], ['/api/auth/me', 'GET'], ['/api/tasks', 'POST']]) {
    const response = await fetch(base + path, { method });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.code, 'DATABASE_MIGRATIONS_PENDING');
    assert.equal(body.pendingMigrations, 1);
  }
  assert.equal(sessionCalls, 0);
  rows = [...rows, { filename: '036.sql' }];
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal((await fetch(base + '/api/tasks')).status, 200);
  assert.equal(sessionCalls, 1);
});

test('uninitialized schema and database outage have distinct, sanitized errors', async () => {
  let code = '42P01';
  const ready = createDatabaseReadiness({ pool: { query: async () => { throw Object.assign(new Error('private connection details'), { code }); } }, migrations: ['001.sql'] });
  assert.equal((await ready.check()).code, 'DATABASE_MIGRATIONS_PENDING');
  code = 'ECONNREFUSED';
  const status = await ready.check({ refresh: true });
  assert.equal(status.code, 'DATABASE_UNAVAILABLE');
  assert.equal(status.database, 'unavailable');
  assert.ok(!JSON.stringify(status).includes('private'));
});

test('concurrent requests share checks and cached failures expire', async () => {
  let time = 0;
  let calls = 0;
  let release;
  const ready = createDatabaseReadiness({
    migrations: ['001.sql'], cacheMs: 5, now: () => time,
    pool: { query: () => { calls++; return new Promise(resolve => { release = resolve; }); } },
  });
  const first = ready.check();
  const second = ready.check();
  assert.equal(calls, 1);
  release({ rows: [] });
  await Promise.all([first, second]);
  assert.equal((await ready.check()).ok, false);
  assert.equal(calls, 1);
  time = 6;
  const recovered = ready.check();
  release({ rows: [{ filename: '001.sql' }] });
  assert.equal((await recovered).ok, true);
  assert.equal(calls, 2);
});
