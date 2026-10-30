import assert from 'node:assert/strict';
import { login, request } from './release-api.mjs';

await login();
const responses = new Map();
let count = 0;
async function check(path, body) {
  const started = performance.now();
  const result = await request(path, body);
  const sizes = Object.fromEntries(Object.entries(result.body).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length]));
  console.log(JSON.stringify({ method: body === undefined ? 'GET' : 'POST', path, status: result.status, ms: Math.round(performance.now() - started), sizes, ...(result.status !== 200 ? { error: result.body } : {}) }));
  assert.equal(result.status, 200);
  responses.set(path, result.body);
  count++;
  return result.body;
}
for (const path of [
  '/api/health', '/api/auth/me', '/api/students', '/api/parameters', '/api/periods', '/api/groups', '/api/field-definitions', '/api/teachers', '/api/intervals', '/api/assignments', '/api/assignments/targets', '/api/sessions', '/api/task-templates', '/api/alerts', '/api/users', '/api/roles', '/api/roles/catalog', '/api/preferences', '/api/saved-views', '/api/audit', '/api/dashboard/summary', '/api/dashboard/trends',
  '/api/cafe/products', '/api/cafe/suppliers', '/api/cafe/purchases', '/api/cafe/sales', '/api/cafe/balances/students', '/api/cafe/inventory', '/api/cafe/reports?from=2026-01-01&to=2026-12-31',
  '/api/accounting/accounts', '/api/accounting/mappings', '/api/accounting/journal', '/api/accounting/periods', '/api/accounting/periods/opening', '/api/agent/status', '/api/agent/transcripts',
]) await check(path);
const students = responses.get('/api/students').students;
const groups = responses.get('/api/groups').groups;
const periods = responses.get('/api/periods').periods;
const sessions = responses.get('/api/sessions').sessions;
const products = responses.get('/api/cafe/products').products;
const accounts = responses.get('/api/accounting/accounts').accounts;
const entries = responses.get('/api/accounting/journal').entries;
for (const [label, values] of Object.entries({ students, groups, periods, sessions, products, accounts, entries })) assert.ok(values?.length, `Fixture needs ${label}`);
const student = students[0].id;
const group = groups[0].id;
const period = periods[0];
const session = sessions[0].id;
for (const path of [
  `/api/students/${student}`, `/api/assignments/memberships?studentId=${student}`, `/api/groups/${group}/members`,
  `/api/periods?assignmentId=${period.assignmentId}`, `/api/tasks?sessionId=${session}`, `/api/tasks/targets?sessionIds=${session}`,
  `/api/evaluations?studentId=${student}`, `/api/evaluations?sessionId=${session}`, `/api/evaluations?assignmentId=${period.assignmentId}`,
  `/api/results?assignmentId=${period.assignmentId}&seq=${period.seq}&dimension=quality`, `/api/results?assignmentId=${period.assignmentId}&seq=${period.seq}&dimension=quantity`,
  `/api/results/scope?periodIds=${periods.slice(0, 4).map(row => row.id).join(',')}`,
  `/api/dashboard/summary?groupId=${group}&assignmentId=${period.assignmentId}`, `/api/dashboard/trends?groupId=${group}&dimension=quantity`,
  `/api/cafe/balances/${student}`, `/api/cafe/inventory/${products[0].id}`, `/api/accounting/journal/${entries[0].id}`,
  '/api/accounting/reports/trial-balance?from=2026-01-01&to=2026-12-31',
  `/api/accounting/reports/ledger?accountId=${accounts[0].id}&from=2026-01-01&to=2026-12-31`,
  '/api/accounting/reports/income-statement?from=2026-01-01&to=2026-12-31', '/api/accounting/reports/balance-sheet?asOf=2026-12-31',
  `/api/export/cube?assignmentId=${period.assignmentId}&periods=${period.seq}`,
]) await check(path);
await check('/api/export/cube', { periodIds: periods.slice(0, 4).map(row => row.id) });
console.log(`PASS ${count} authenticated reads, all HTTP 200`);
