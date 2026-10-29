import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Execute byte-identical source from an audit-only fixture so the entrypoint's
// hard-coded transcript directory cannot modify agent/logs or real .env files.
// A local fake read-only Panel API isolates this startup/input-loop check.
const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = await fs.mkdtemp(path.join(root, 'audit/.tmp/missing-mic-'));
await fs.cp(path.join(root, 'agent/src'), path.join(fixture, 'agent/src'), { recursive: true });
await fs.writeFile(path.join(fixture, 'agent/package.json'), '{"type":"module"}');
await fs.mkdir(path.join(fixture, 'empty-path'));
const original = await fs.readFile(path.join(root, 'agent/src/index.js'));
assert.deepEqual(await fs.readFile(path.join(fixture, 'agent/src/index.js')), original);
const requests = [];
const server = createServer((req, res) => {
  requests.push({ method: req.method, path: req.url });
  const user = { username: 'audit-kiosk', role: 'Kiosk', permissions: ['cafe.view'] };
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/auth/me' || req.url === '/api/auth/login') {
    res.end(JSON.stringify({ user }));
  } else if (req.url === '/api/cafe/products') {
    res.end(JSON.stringify({ products: [] }));
  } else {
    res.writeHead(404).end('{}');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const child = spawn(process.execPath, [path.join(fixture, 'agent/src/index.js')], {
  cwd: fixture,
  env: {
    PATH: path.join(fixture, 'empty-path'), TMPDIR: path.join(root, 'audit/.tmp'),
    PANEL_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    KIOSK_USERNAME: 'audit-kiosk', KIOSK_PASSWORD: 'disposable-local-fixture',
    KIOSK_HOST: '127.0.0.1', KIOSK_PORT: '0', VOICE_STAGE: '2',
    LLM_PROVIDER: 'none', STT_PROVIDER: 'openai',
    STT_BASE_URL: `http://127.0.0.1:${server.address().port}`, TTS_PROVIDER: 'none',
    AGENT_DATABASE_URL: '', AGENT_LANGUAGE: 'en',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let output = '';
let inputSent = false;
let watchdog;
function inspect(chunk) {
  output += chunk;
  if (inputSent || !output.includes('falling back to text.')) return;
  inputSent = true;
  child.stdin.end('menu\n');
  // Working fallback installs readline synchronously after the log and exits
  // on EOF. The watchdog bounds a broken child which keeps only its HTTP server.
  watchdog = setTimeout(() => child.kill('SIGTERM'), 1000);
}
child.stdout.on('data', inspect);
child.stderr.on('data', inspect);
const startupLimit = setTimeout(() => child.kill('SIGTERM'), 10000);
try {
  const result = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  console.log(JSON.stringify({ ...result, inputSent,
    indexSha256: createHash('sha256').update(original).digest('hex'),
    fallbackAnnounced: output.includes('falling back to text.'),
    replStarted: output.includes('text mode — type a line'),
    productRequests: requests.filter(r => r.path === '/api/cafe/products').length,
    output }, null, 2));
  assert.equal(inputSent, true, 'must reach missing microphone branch');
  assert.equal(output.includes('text mode — type a line'), true, 'announced fallback must actually start text input');
  assert.equal(result.code, 0, 'text REPL must consume EOF and exit normally');
} finally {
  clearTimeout(startupLimit);
  clearTimeout(watchdog);
  child.kill('SIGTERM');
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
