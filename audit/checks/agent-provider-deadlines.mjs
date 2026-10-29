import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createLlmBrain } from '../../agent/src/llm.js';
import { Dialogue } from '../../agent/src/dialogue.js';
import { Panel } from '../../agent/src/panel.js';

// Controlled local stalled endpoints, no real provider/audio/financial writes.
// Observation duration is a harness bound, not an invented product deadline.
const held = [];
const server = createServer((req, res) => {
  req.resume();
  held.push({ path: req.url, res });
  if (held.length === 5) allAccepted.resolve();
});
const allAccepted = Promise.withResolvers();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
Object.assign(process.env, { STT_PROVIDER: 'openai', STT_BASE_URL: baseUrl,
  STT_API_KEY: '', TTS_PROVIDER: 'openai', TTS_BASE_URL: baseUrl, TTS_API_KEY: '' });
const { createStt } = await import('../../agent/src/speech/stt.js');
const { createTts } = await import('../../agent/src/speech/tts.js');
const nativeFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = (url, options = {}) => {
  assert.equal(new URL(url).origin, baseUrl, 'every request stays on local fake server');
  requests.push({ path: new URL(url).pathname, hasAbortSignal: !!options.signal });
  return nativeFetch(url, options);
};
const observed = [];
const spoken = [];
let pending = [];
try {
  const openai = await createLlmBrain({ llmProvider: 'openai', llmBaseUrl: baseUrl, llmModel: 'fixture' });
  const ollama = await createLlmBrain({ llmProvider: 'ollama', ollamaUrl: baseUrl, ollamaModel: 'fixture' });
  const stt = await createStt();
  const tts = await createTts();
  const dialogue = new Dialogue({ brain: openai, stage: 2, sessionId: 'audit-deadlines',
    sink: { say: text => spoken.push(text), event() {} }, defaultLanguage: 'en' });
  dialogue.bindHandlers({ list_products: async () => ({ products: [] }) });
  const panel = new Panel({ baseUrl, username: '', password: '' });
  const jobs = [
    ['openai-dialogue', () => dialogue.turn('menu')],
    ['ollama', () => ollama.respond({ text: 'menu', state: { history: [] }, handlers: {}, lang: 'en' })],
    ['stt', () => stt.transcribe(Buffer.from('synthetic audio'))],
    ['tts', () => tts.synthesize('synthetic speech')],
    ['panel-read', () => panel.request('/api/cafe/products')],
  ];
  pending = jobs.map(([name, run]) => {
    const result = { name, settled: false };
    observed.push(result);
    return Promise.resolve().then(run).then(
      () => { result.settled = true; result.outcome = 'resolved'; },
      error => { result.settled = true; result.outcome = error.message; },
    );
  });
  await Promise.race([allAccepted.promise, delay(10000).then(() => { throw new Error('fixture did not receive all five requests'); })]);
  const start = performance.now();
  await delay(1500);
  console.log(JSON.stringify({ observationMs: Math.round(performance.now() - start),
    requests, pendingBeforeRelease: observed.filter(r => !r.settled).map(r => r.name),
    dialogueRepliesBeforeRelease: spoken.length }, null, 2));
  for (const { res } of held) res.writeHead(503, { 'content-type': 'text/plain' }).end('audit fixture released');
  await Promise.all(pending);
  console.log(JSON.stringify({ afterRelease: observed, dialogueRepliesAfterRelease: spoken.length }, null, 2));
  assert.equal(requests.length, 5);
  assert.equal(spoken.length, 1, 'error response allows dialogue to fall back to rules');
} finally {
  globalThis.fetch = nativeFetch;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
