import assert from 'node:assert/strict';
import { openDatabase } from './isolated.mjs';
import cases from './schedule-calendar-cases.mjs';

// SELECT-only check of the anchor+n*interval arithmetic used by the actual
// generator (server/src/lib/sessions.js:33). This does not generate sessions.
const db = openDatabase();
try {
  assert.deepEqual((await db.query('SELECT current_database() AS name, inet_server_port() AS port')).rows[0],
    { name: 'student_panel_audit', port: 55439 });
  for (const item of cases) {
    const result = (await db.query(`SELECT min(planned)::text AS next FROM (
      SELECT ($1::date + n * $2::interval)::date AS planned
      FROM generate_series(0, 12) n
    ) dates WHERE planned >= $3::date`, [item.anchor, item.sqlInterval, item.today])).rows[0].next;
    assert.equal(result, item.expected, item.name);
    console.log(JSON.stringify({ name: item.name, anchor: item.anchor, today: item.today, expected: item.expected, postgresNext: result }));
  }
} finally { await db.end(); }
