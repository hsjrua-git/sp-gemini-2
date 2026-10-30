// API smoke: log in as an admin and GET every read endpoint the app has, so
// SQL that only fails at runtime (bad column, unpassed parameters) is caught
// the same way the app hits it. Run with the server up:
//   cd server && npm start                                  (terminal 1)
//   cd agent && node --env-file=../server/.env ../agent/scripts/apiSmoke.mjs
// (runs from agent/ so it can borrow the panel client + server env)

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const agentDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromServer = createRequire(join(agentDir, '..', 'server', 'package.json'));
const { hashPassword, verifyPassword } = requireFromServer('../server/src/lib/passwords.js');

const { config } = await import('../src/config.js');
const { Panel, PanelError } = await import('../src/panel.js');

const local = new Date();
const today = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

// Every GET endpoint with the query its own UI sends. Path params are
// resolved from the list responses as the smoke runs.
const CHECKS = [
  { get: () => ['/api/health'] },
  { get: () => ['/api/auth/me'] },
  { get: () => ['/api/students?pageSize=5'] },
  { get: () => ['/api/groups'] },
  { get: () => ['/api/teachers'] },
  { get: () => ['/api/intervals'] },
  { get: () => [`/api/assignments`] },
  { get: () => [`/api/sessions?from=${monthAgo}&to=${today}`] },
  { get: () => ['/api/tasks?sessionId=00000000-0000-4000-8000-000000000000'] },
  { get: () => ['/api/task-templates'] },
  { get: () => ['/api/alerts'] },
  { get: () => ['/api/parameters'] },
  { get: () => ['/api/dashboard/trends'] },
  { get: () => ['/api/dashboard/summary'] },
  { get: () => ['/api/export/cube'] },
  { get: () => ['/api/evaluations?studentId=00000000-0000-4000-8000-000000000000'] },
  { get: () => ['/api/roles'] },
  { get: () => ['/api/users'] },
  { get: () => ['/api/audit?page=1'] },
  { get: () => ['/api/field-definitions'] },
  { get: () => ['/api/saved-views'] },
  { get: () => ['/api/preferences'] },
  { get: () => ['/api/cafe/products'] },
  { get: () => ['/api/cafe/suppliers'] },
  { get: () => [`/api/cafe/purchases?from=${monthAgo}&to=${today}`] },
  { get: () => [`/api/cafe/sales?from=${monthAgo}&to=${today}`] },
  { get: () => ['/api/cafe/balances/students?search=a'] },
  { get: () => ['/api/cafe/inventory'] },
  { get: () => [`/api/cafe/reports?from=${monthAgo}&to=${today}`] },
  { get: () => ['/api/accounting/accounts'] },
  { get: () => ['/api/accounting/mappings'] },
  { get: () => ['/api/accounting/journal'] },
  { get: () => ['/api/accounting/periods'] },
  { get: () => ['/api/accounting/periods/opening'] },
  { get: () => [`/api/accounting/reports/trial-balance?from=${monthAgo}&to=${today}`] },
  { get: () => [`/api/accounting/reports/income-statement?from=${monthAgo}&to=${today}`] },
  { get: () => [`/api/accounting/reports/balance-sheet?asOf=${today}`] },
  { get: () => ['/api/agent/status'] },
  { get: () => [`/api/agent/transcripts?from=${monthAgo}&to=${today}`] },
  // id-dependent ones are appended dynamically below
];

const pool = new (requireFromServer('pg').Pool)({
  connectionString: process.env.DATABASE_URL,
});

let temp = null;
try {
  // Always run as a THROWAWAY admin created for this smoke (never touch a
  // real account's credentials); removed in the finally block.
  // A previous crashed run may have left the throwaway user behind — clear
  // it in FK order (journal lines → entries → audit → user) before seeding.
  const stale = (
    await pool.query(`SELECT id FROM users WHERE username = 'zz-api-smoke'`)
  ).rows[0];
  if (stale) {
    // Trigger toggles are transactional. A killed/failed cleanup therefore
    // rolls them back instead of leaving ledger protection disabled globally.
    const cleanup = await pool.connect();
    try {
      await cleanup.query('BEGIN');
      await cleanup.query('ALTER TABLE acct_journal_lines DISABLE TRIGGER acct_lines_draft_only_trg');
      await cleanup.query('ALTER TABLE acct_journal_lines DISABLE TRIGGER acct_entry_balance_trg');
      await cleanup.query('ALTER TABLE acct_journal_entries DISABLE TRIGGER acct_entry_lifecycle_trg');
      await cleanup.query(
        `DELETE FROM acct_journal_lines WHERE entry_id IN
           (SELECT id FROM acct_journal_entries WHERE posted_by = $1 OR created_by = $1)`,
        [stale.id]
      );
      await cleanup.query(
        `DELETE FROM acct_journal_entries WHERE posted_by = $1 OR created_by = $1`,
        [stale.id]
      );
      await cleanup.query(`DELETE FROM audit_log WHERE user_id = $1`, [stale.id]);
      await cleanup.query(`DELETE FROM users WHERE id = $1`, [stale.id]);
      await cleanup.query('ALTER TABLE acct_journal_entries ENABLE TRIGGER acct_entry_lifecycle_trg');
      await cleanup.query('ALTER TABLE acct_journal_lines ENABLE TRIGGER acct_entry_balance_trg');
      await cleanup.query('ALTER TABLE acct_journal_lines ENABLE TRIGGER acct_lines_draft_only_trg');
      await cleanup.query('COMMIT');
    } catch (err) {
      await cleanup.query('ROLLBACK');
      throw err;
    } finally {
      cleanup.release();
    }
  }
  const username = 'zz-api-smoke';
  const password = 'api-smoke-' + Math.random().toString(36).slice(2, 12);
  const adminRole = (
    await pool.query(`SELECT id FROM roles WHERE lower(name) = 'administrator'`)
  ).rows[0];
  temp = (
    await pool.query(
      `INSERT INTO users (username, full_name, role_id, password_hash, must_change_password)
       VALUES ($1, 'API Smoke', $2, $3, false) RETURNING id`,
      [username, adminRole.id, await hashPassword(password)]
    )
  ).rows[0].id;

  const panel = new Panel({ baseUrl: config.panelBaseUrl, username, password });
  await panel.login();

  // Resolve ids the id-dependent checks need. Periods are per assignment now,
  // so the assignment list drives the evaluation/results/period checks.
  const [students, products, assignments, sessions] = await Promise.all([
    panel.request('/api/students?pageSize=1').then((d) => d.students ?? []),
    panel.request('/api/cafe/products').then((d) => d.products ?? []),
    panel.request('/api/assignments').then((d) => d.assignments ?? []),
    panel.request(`/api/sessions?from=${monthAgo}&to=${today}`).then((d) => d.sessions ?? []),
  ]);
  const studentId = students[0]?.id;
  const productId = products[0]?.id;
  const assignmentId = assignments[0]?.id;
  const sessionId = sessions[0]?.id;

  const idChecks = [];
  if (studentId) {
    idChecks.push(
      { get: () => [`/api/students/${studentId}`] },
      { get: () => [`/api/evaluations?studentId=${studentId}`] },
      { get: () => [`/api/cafe/balances/${studentId}`] },
    );
  }
  if (productId) {
    idChecks.push({ get: () => [`/api/cafe/inventory/${productId}`] });
    idChecks.push({
      get: () => [
        `/api/accounting/reports/ledger?accountId=${productId}&from=${monthAgo}&to=${today}`,
      ],
      expectFail: true, // a product is not an account — 404 is correct
    });
  }
  if (assignmentId) {
    idChecks.push(
      { get: () => [`/api/periods?assignmentId=${assignmentId}`] },
      { get: () => [`/api/evaluations?assignmentId=${assignmentId}`] },
      { get: () => [`/api/dashboard/summary?assignmentId=${assignmentId}`] },
      { get: () => [`/api/dashboard/trends?dimension=quantity`] },
      { get: () => [`/api/export/cube?assignmentId=${assignmentId}&periods=1`] },
    );
    // The results grid only exists once a period has sessions; pick a real seq.
    const periods = await panel
      .request(`/api/periods?assignmentId=${assignmentId}`)
      .then((d) => d.periods ?? [])
      .catch(() => []);
    const liveSeq = periods.find((p) => (p.sessionCount ?? 0) > 0)?.seq;
    if (liveSeq !== undefined) {
      idChecks.push(
        { get: () => [`/api/results?assignmentId=${assignmentId}&seq=${liveSeq}&dimension=quality`] },
        { get: () => [`/api/results?assignmentId=${assignmentId}&seq=${liveSeq}&dimension=quantity`] },
      );
    }
  }
  if (sessionId) {
    idChecks.push({ get: () => [`/api/evaluations?sessionId=${sessionId}`] });
  }

  const failures = [];
  let checked = 0;
  for (const check of [...CHECKS, ...idChecks]) {
    for (const path of check.get()) {
      checked += 1;
      try {
        await panel.request(path);
      } catch (err) {
        const status = err instanceof PanelError ? err.status : 0;
        const expected = check.expectFail && status === 404;
        if (!expected) {
          failures.push({ path, status, message: err.message.slice(0, 120) });
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error(`api smoke: ${checked} endpoints, ${failures.length} FAILED`);
    for (const f of failures) {
      console.error(`  ${f.status ?? 'ERR'} ${f.path} — ${f.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`api smoke: ${checked} endpoints, all OK`);
  }

} finally {
  await pool.query(`DELETE FROM audit_log WHERE user_id = $1`, [temp]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE id = $1`, [temp]).catch(() => {});
  await pool.end();
}
