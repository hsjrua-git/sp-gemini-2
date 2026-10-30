import assert from 'node:assert/strict';

const base = process.env.TEST_SERVER_URL;
if (!base || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Set a loopback TEST_SERVER_URL');
const cookies = new Map();
export async function request(path, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: base, 'content-type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...(cookies.has('csrf') ? { 'x-csrf-token': cookies.get('csrf') } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(';')[0];
    cookies.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
  }
  return { status: response.status, body: await response.json() };
}
export async function login() {
  const response = await request('/api/auth/login', { username: process.env.TEST_USERNAME || 'sample-admin', password: process.env.TEST_PASSWORD || 'sample-panel-2026' });
  assert.equal(response.status, 200, `login: ${JSON.stringify(response.body)}`);
}
