import assert from 'node:assert/strict';
import pg from '../../server/node_modules/pg/lib/index.js';

// Hard-coded loopback-only audit endpoints deliberately ignore DATABASE_URL.
export const databaseUrl = 'postgresql://audit_owner@127.0.0.1:55439/student_panel_audit';
export const baseUrl = 'http://127.0.0.1:3300';
export const openDatabase = () => new pg.Pool({
  connectionString: databaseUrl,
  max: 4,
  connectionTimeoutMillis: 3000,
  statement_timeout: 10000,
});

export function api() {
  const cookies = new Map();
  return async (path, { method = 'GET', body } = {}) => {
    assert.ok(path.startsWith('/api/'));
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
        ...(cookies.has('csrf') ? { 'x-csrf-token': cookies.get('csrf') } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0];
      const index = pair.indexOf('=');
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  };
}

export async function login(call, username = 'sample-admin') {
  const result = await call('/api/auth/login', {
    method: 'POST', body: { username, password: 'sample-panel-2026' },
  });
  assert.equal(result.status, 200, `login ${username}`);
  return result.data.user;
}
