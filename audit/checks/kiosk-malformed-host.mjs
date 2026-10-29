import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { once } from 'node:events';

// A fresh local child contains a possible crash. No real agent process, model,
// transcript sink, or database is involved. Only the shipping kiosk HTTP code.
if (process.argv.includes('--child')) {
  const { startKiosk } = await import('../../agent/src/kiosk.js');
  const { server } = await startKiosk({ dialogueRef: {}, host: '127.0.0.1', port: 0, label: 'audit' });
  process.send({ port: server.address().port });
} else {
  const child = spawn(process.execPath, [import.meta.filename, '--child'], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, AGENT_DATABASE_URL: '', LLM_PROVIDER: 'none', STT_PROVIDER: 'none', TTS_PROVIDER: 'none' },
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const closed = once(child, 'close');
  try {
    const [{ port }] = await once(child, 'message', { signal: AbortSignal.timeout(5000) });
    const observed = await new Promise(resolve => {
      const req = request({ hostname: '127.0.0.1', port, path: '/', headers: { Host: '[' }, timeout: 3000 }, res => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode }));
      });
      req.on('error', err => resolve({ networkError: err.code }));
      req.on('timeout', () => req.destroy(new Error('audit request timeout')));
      req.end();
    });
    if (observed.status === undefined) {
      const [exit, signal] = await closed;
      Object.assign(observed, { exit, signal, invalidUrl: stderr.includes('ERR_INVALID_URL') });
    }
    console.log(JSON.stringify(observed, null, 2));
    assert.equal(observed.status, 400, 'malformed Host must be rejected without crashing the kiosk');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
  }
}
