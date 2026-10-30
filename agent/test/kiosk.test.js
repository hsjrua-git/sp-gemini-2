import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';

function call(port, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/', timeout: 3000, ...options }, res => {
      let body = '';
      res.on('data', data => { body += data; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('kiosk request timeout')));
    req.end();
  });
}

for (const [name, options, expected] of [
  ['malformed Host', { headers: { Host: '[' } }, 400],
  ['malformed absolute URL', { path: 'http://[' }, 400],
  ['rejected confirmation', { method: 'POST', path: '/confirm' }, 500],
  ['rejected cancellation', { method: 'POST', path: '/cancel' }, 500],
]) {
  test(`kiosk contains ${name} and keeps serving`, async () => {
    const child = fork(new URL('./fixtures/kiosk.js', import.meta.url), [], { silent: true });
    const closed = once(child, 'close');
    try {
      const [{ port }] = await once(child, 'message', { signal: AbortSignal.timeout(5000) });
      const response = await call(port, options);
      assert.equal(response.status, expected);
      assert.equal(response.body, '', 'failure response exposes no internal detail');
      assert.equal(child.exitCode, null);
      const page = await call(port);
      assert.equal(page.status, 200);
      assert.match(page.body, /<!doctype html>/);
      assert.equal((await call(port, { method: 'POST', path: '/confirm', headers: { origin: 'https://foreign.example' } })).status, 403);
      if (name === 'rejected confirmation') {
        assert.equal((await call(port, { method: 'POST', path: '/confirm' })).status, 204);
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await closed;
    }
  });
}
