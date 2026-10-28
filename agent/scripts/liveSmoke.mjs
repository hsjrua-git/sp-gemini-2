// Live smoke for the voice agent: exercises the REAL HTTP path — kiosk-user
// login (sessions + CSRF), menu read, student lookup, and a full
// sale→void round trip through the Dialogue — against the running Student
// Panel server. Everything it creates is removed afterwards by the DB owner
// (the ledger's immutability triggers are disabled only for that cleanup).
// Run with the server up:
//   cd server && npm start                                  (terminal 1)
//   cd agent && node --env-file=../server/.env scripts/liveSmoke.mjs
//                                                           (terminal 2)

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const agentDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromServer = createRequire(join(agentDir, '..', 'server', 'package.json'));
const { Pool } = requireFromServer('pg');
const { hashPassword } = requireFromServer('../server/src/lib/passwords.js');

const { config } = await import('../src/config.js');
const { Panel } = await import('../src/panel.js');
const { makeToolHandlers } = await import('../src/tools.js');
const { Dialogue } = await import('../src/dialogue.js');

const PRODUCT = 'ZZVoiceSmoke';
const USERNAME = 'zz-voice-smoke';
const PASSWORD = 'kiosk-smoke-' + Math.random().toString(36).slice(2, 12);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Remove every row the smoke created for (or by) one of its users. Order
// follows the FKs; the ledger triggers are disabled because the DB owner is
// deleting its OWN smoke artifacts — never a normal operation.
async function cleanupSmoke(client, userIds) {
  await client.query('BEGIN');
  await client.query('ALTER TABLE cafe_stock_movements DISABLE TRIGGER cafe_stock_movements_append_only');
  await client.query('ALTER TABLE acct_journal_lines DISABLE TRIGGER acct_lines_draft_only_trg');
  await client.query('ALTER TABLE acct_journal_lines DISABLE TRIGGER acct_entry_balance_trg');
  await client.query('ALTER TABLE acct_journal_entries DISABLE TRIGGER acct_entry_lifecycle_trg');
  await client.query(
    `DELETE FROM cafe_stock_movements
     WHERE created_by = ANY($1::uuid[])
        OR reference_id IN (SELECT id FROM cafe_sales WHERE sold_by = ANY($1::uuid[]))`,
    [userIds]
  );
  await client.query(
    `DELETE FROM cafe_sale_items WHERE sale_id IN
       (SELECT id FROM cafe_sales WHERE sold_by = ANY($1::uuid[]))`,
    [userIds]
  );
  await client.query(`DELETE FROM cafe_sales WHERE sold_by = ANY($1::uuid[])`, [userIds]);
  await client.query(
    `DELETE FROM acct_journal_lines WHERE entry_id IN
       (SELECT id FROM acct_journal_entries
        WHERE posted_by = ANY($1::uuid[]) OR created_by = ANY($1::uuid[]))`,
    [userIds]
  );
  await client.query(
    `DELETE FROM acct_journal_entries
     WHERE posted_by = ANY($1::uuid[]) OR created_by = ANY($1::uuid[])`,
    [userIds]
  );
  await client.query(`DELETE FROM cafe_products WHERE name = $1`, [PRODUCT]);
  await client.query(`DELETE FROM audit_log WHERE user_id = ANY($1::uuid[])`, [userIds]);
  await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  await client.query('ALTER TABLE cafe_stock_movements ENABLE TRIGGER cafe_stock_movements_append_only');
  await client.query('ALTER TABLE acct_journal_entries ENABLE TRIGGER acct_entry_lifecycle_trg');
  await client.query('ALTER TABLE acct_journal_lines ENABLE TRIGGER acct_entry_balance_trg');
  await client.query('ALTER TABLE acct_journal_lines ENABLE TRIGGER acct_lines_draft_only_trg');
  await client.query('COMMIT');
}

try {
  // --- seed: a fresh kiosk user and one smoke product ----------------------
  const role = (await pool.query(`SELECT id FROM roles WHERE lower(name) = 'kiosk'`)).rows[0];
  assert.ok(role, 'the Kiosk role is missing — run migration 027');

  // Re-runs start clean: clear any leftover smoke users (previous failed
  // runs rolled their cleanup back).
  const leftovers = (await pool.query(`SELECT id FROM users WHERE username = $1`, [USERNAME])).rows;
  if (leftovers.length > 0) {
    const client = await pool.connect();
    try {
      await cleanupSmoke(client, leftovers.map((row) => row.id));
    } finally {
      client.release();
    }
  }

  const user = (
    await pool.query(
      `INSERT INTO users (username, full_name, role_id, password_hash, must_change_password)
       VALUES ($1, 'Voice Smoke', $2, $3, false) RETURNING id`,
      [USERNAME, role.id, await hashPassword(PASSWORD)]
    )
  ).rows[0];
  const product = (
    await pool.query(
      `INSERT INTO cafe_products (name, price) VALUES ($1, 15000) RETURNING id`,
      [PRODUCT]
    )
  ).rows[0];

  // --- the dialogue over the real API --------------------------------------
  const spoken = [];
  const dialogue = new Dialogue({
    panel: new Panel({
      baseUrl: config.panelBaseUrl,
      username: USERNAME,
      password: PASSWORD,
    }),
    brain: { available: false },
    stage: 4, // the smoke drives the full protocol by voice
    sink: {
      say: (text) => spoken.push(text),
      event: () => {},
    },
    sessionId: 'smoke',
    defaultLanguage: 'fa',
  });
  dialogue.bindHandlers(makeToolHandlers({ panel: dialogue.panel, state: dialogue.state }));

  // 1. Login over HTTP — sessions + CSRF exactly like a human cashier.
  await dialogue.panel.login();
  assert.equal(dialogue.panel.user.role.toLowerCase(), 'kiosk', 'logged in as kiosk');

  // 2. Menu read through the real API.
  await dialogue.turn('منو چی داری؟');
  assert.match(spoken.at(-1), new RegExp(PRODUCT), 'the smoke product is on the spoken menu');

  // 3. Balance read (the minimal-identity finder, no students.view).
  const student = (
    await pool.query(
      'SELECT full_name FROM students WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1'
    )
  ).rows[0];
  await dialogue.turn(`مانده ${student.full_name} چقدره؟`);
  assert.match(spoken.at(-1), /مانده|بدهکار/, 'a balance was spoken');

  // 4. The full confirmation protocol, by voice, stage 4.
  await dialogue.turn(`یه ${PRODUCT}`);
  await dialogue.turn('ثبت بشه');
  await dialogue.turn('بله');
  assert.match(spoken.at(-1), /ثبت شد/, 'the sale was recorded by voice');

  const sale = (
    await pool.query(
      `SELECT id, total, voided_at FROM cafe_sales
       WHERE note = 'voice: stage-4' ORDER BY created_at DESC LIMIT 1`
    )
  ).rows[0];
  assert.ok(sale, 'the sale row exists with the voice note');
  assert.equal(Number(sale.total), 15000);
  assert.equal(sale.voided_at, null);

  // 5. Void by voice; the ledger rows reverse and the sale is marked.
  await dialogue.turn('پشیمونم، برگردون');
  assert.match(spoken.at(-1), /ابطال/);
  const voided = (
    await pool.query('SELECT voided_at IS NOT NULL AS voided FROM cafe_sales WHERE id = $1', [
      sale.id,
    ])
  ).rows[0];
  assert.equal(voided.voided, true, 'the sale is marked voided, not deleted');

  console.log('live smoke: all 5 checks passed');
} finally {
  // --- cleanup: leave the database exactly as it was -----------------------
  const client = await pool.connect();
  try {
    const mine = (
      await pool.query(`SELECT id FROM users WHERE username = $1`, [USERNAME])
    ).rows.map((row) => row.id);
    if (mine.length > 0) await cleanupSmoke(client, mine);
    console.log('cleanup: smoke rows removed, triggers re-enabled');
  } catch (err) {
    console.error('CLEANUP FAILED — smoke rows remain:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}
