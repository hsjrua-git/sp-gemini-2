import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { databaseUrl, openDatabase } from './isolated.mjs';

// Run the unchanged psql deployment template, including its actual grants,
// inside ONE transaction on the pinned audit cluster. Role creation, defaults,
// grants, audit edits and stock truncation all end in ROLLBACK.
const db = openDatabase();
const suffix = randomBytes(6).toString('hex');
const appRole = `audit_grant_app_${suffix}`;
const readRole = `audit_grant_read_${suffix}`;
const template = await fs.readFile(new URL('../../deploy/postgres-roles.example.sql', import.meta.url), 'utf8');

async function snapshot() {
  const result = {};
  for (const table of ['audit_log', 'cafe_stock_movements']) {
    result[table] = (await db.query(`SELECT count(*)::int AS count,
      md5(string_agg(to_jsonb(t)::text, '' ORDER BY id)) AS fingerprint FROM ${table} t`)).rows[0];
  }
  result.acls = (await db.query(`SELECT 'table:' || c.oid AS object, c.relacl::text AS acl
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    UNION ALL SELECT 'function:' || p.oid, p.proacl::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    UNION ALL SELECT 'schema:' || oid, nspacl::text FROM pg_namespace WHERE nspname='public'
    UNION ALL SELECT 'default:' || oid, defaclacl::text FROM pg_default_acl
    ORDER BY object`)).rows;
  return result;
}

let before;
let observed;
try {
  const identity = (await db.query('SELECT current_database() AS db, inet_server_port() AS port')).rows[0];
  assert.deepEqual(identity, { db: 'student_panel_audit', port: 55439 });
  before = await snapshot();
  assert.ok(before.audit_log.count > 0 && before.cafe_stock_movements.count > 0, 'representative history required');
  const sql = `\\set owner_role audit_owner
\\set app_role ${appRole}
\\set readonly_role ${readRole}
\\set app_password ${randomBytes(32).toString('hex')}
\\set readonly_password ${randomBytes(32).toString('hex')}
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';
${template}
SET LOCAL ROLE ${appRole};
DO $probe$
DECLARE
  changed integer := 0;
  removed integer := 0;
  audit_update_code text := NULL;
  audit_delete_code text := NULL;
  stock_delete_code text := NULL;
  stock_truncate_code text := NULL;
  remaining integer;
  audit_id bigint;
BEGIN
  SELECT min(id) INTO audit_id FROM audit_log;
  BEGIN
    UPDATE audit_log SET action = 'audit.grant_probe_rewrite' WHERE id = audit_id;
    GET DIAGNOSTICS changed = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN audit_update_code := SQLSTATE;
  END;
  BEGIN
    DELETE FROM audit_log WHERE id = audit_id;
    GET DIAGNOSTICS removed = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN audit_delete_code := SQLSTATE;
  END;
  BEGIN
    DELETE FROM cafe_stock_movements WHERE id = (SELECT id FROM cafe_stock_movements LIMIT 1);
  EXCEPTION WHEN OTHERS THEN stock_delete_code := SQLSTATE;
  END;
  BEGIN
    TRUNCATE cafe_stock_movements;
  EXCEPTION WHEN OTHERS THEN stock_truncate_code := SQLSTATE;
  END;
  SELECT count(*) INTO remaining FROM cafe_stock_movements;
  RAISE NOTICE 'PROBE %', json_build_object(
    'superuser', (SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
    'ownsStock', (SELECT pg_get_userbyid(relowner)=current_user FROM pg_class WHERE oid='cafe_stock_movements'::regclass),
    'auditUpdated', changed, 'auditDeleted', removed,
    'auditUpdateCode', audit_update_code, 'auditDeleteCode', audit_delete_code,
    'stockDeleteCode', stock_delete_code, 'stockTruncateCode', stock_truncate_code,
    'stockRemaining', remaining);
END $probe$;
RESET ROLE;
ROLLBACK;
`;
  const child = spawn('psql', [databaseUrl, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exit = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  child.stdin.end(sql);
  const result = await exit;
  assert.equal(result.code, 0, `template/probe SQL must execute: ${output}`);
  const match = output.match(/PROBE (\{[^\n]+\})/);
  assert.ok(match, 'structured probe output');
  observed = JSON.parse(match[1]);
  console.log(JSON.stringify({ before: { audit: before.audit_log.count, stock: before.cafe_stock_movements.count }, observed }, null, 2));
} finally {
  try {
    if (before) {
      assert.deepEqual(await snapshot(), before, 'transaction rollback must preserve exact history and ACLs');
      assert.equal((await db.query('SELECT count(*)::int AS count FROM pg_roles WHERE rolname = ANY($1::text[])', [[appRole, readRole]])).rows[0].count, 0);
      console.log('ROLLBACK verified: audit/stock fingerprints and all captured ACLs match; temporary roles absent.');
    }
  } finally {
    await db.end();
  }
}
assert.equal(observed.superuser, false);
assert.equal(observed.ownsStock, false);
assert.ok(['P0001', '42501'].includes(observed.stockDeleteCode), 'negative control: DELETE must be refused');
assert.deepEqual({ updated: observed.auditUpdated, deleted: observed.auditDeleted, stock: observed.stockRemaining },
  { updated: 0, deleted: 0, stock: before.cafe_stock_movements.count },
  'least-privilege runtime role must preserve audit and append-only stock history');
