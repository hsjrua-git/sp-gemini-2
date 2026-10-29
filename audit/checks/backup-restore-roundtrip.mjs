import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import pg from '../../server/node_modules/pg/lib/index.js';
import { databaseUrl, openDatabase } from './isolated.mjs';

// The project scripts are executed unchanged. Only the uniquely named restore
// database is overwritten/dropped; the working evidence database is dump-only.
const root = path.resolve(import.meta.dirname, '../..');
const suffix = randomUUID().replaceAll('-', '');
const name = `student_panel_restore_${suffix}`;
assert.match(name, /^student_panel_restore_[a-f0-9]+$/);
const destinationUrl = `postgresql://audit_owner@127.0.0.1:55439/${name}`;
const folder = path.join(root, 'audit/.tmp', `restore-${suffix}`);
await fs.mkdir(folder, { recursive: true, mode: 0o700 });
const env = { ...process.env, DATABASE_URL: destinationUrl,
  ENV_FILE: path.join(folder, 'no-env'), PGHOST: '127.0.0.1', PGPORT: '55439',
  PGUSER: 'audit_owner', PGDATABASE: name, PSQLRC: path.join(folder, 'no-psqlrc') };
delete env.PGPASSWORD;
delete env.PGSERVICE;
const source = openDatabase();
const destination = new pg.Pool({ connectionString: destinationUrl,
  connectionTimeoutMillis: 3000, statement_timeout: 20000 });
const outcomes = [];
let created = false;

async function run(label, executable, args, { input = '', environment = env } = {}) {
  const started = new Date().toISOString();
  const child = spawn(executable, args, { cwd: root, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  // A rejecting psql may close the pipe before consuming the dump.
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') stderr += error.message; });
  child.stdin.end(input);
  const result = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  await fs.writeFile(path.join(folder, `${label}.txt`), stdout + stderr, { mode: 0o600 });
  const metadata = { label, command: [executable, ...args], started,
    ended: new Date().toISOString(), ...result, stdoutBytes: stdout.length,
    stderr: stderr.slice(-1500) };
  outcomes.push(metadata);
  console.log(JSON.stringify(metadata));
  return { ...result, stdout, stderr };
}

async function fingerprint(db) {
  const tables = (await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  )).rows;
  const result = [];
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    const rows = (await db.query(`SELECT to_jsonb(t)::text AS value FROM public."${tablename}" t ORDER BY 1`)).rows;
    result.push({ table: tablename, count: rows.length,
      sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') });
  }
  return result;
}

try {
  assert.equal((await source.query('SELECT current_database() AS name')).rows[0].name, 'student_panel_audit');
  const before = await fingerprint(source);
  const backup = await run('project-backup', 'bash', ['deploy/backup.sh'], {
    environment: { ...env, DATABASE_URL: databaseUrl, BACKUP_DIR: path.join(folder, 'backups'), KEEP: '1' },
  });
  assert.equal(backup.code, 0, 'the actual backup script must succeed');
  const dumps = (await fs.readdir(path.join(folder, 'backups'))).filter(file => file.endsWith('.sql.gz'));
  assert.equal(dumps.length, 1);
  const dumpFile = path.join(folder, 'backups', dumps[0]);
  const dump = gunzipSync(await fs.readFile(dumpFile));
  assert.deepEqual(await fingerprint(source), before, 'source remained stable during backup');
  assert.equal((await run('create-disposable', 'createdb', [
    '--maintenance-db', databaseUrl, '--template', 'template0', name,
  ])).code, 0);
  created = true;
  assert.equal((await destination.query('SELECT current_database() AS name')).rows[0].name, name);
  await destination.query("CREATE TABLE audit_restore_probe (value text); INSERT INTO audit_restore_probe VALUES ('original')");

  const invalidFile = path.join(folder, 'invalid.sql.gz');
  await fs.writeFile(invalidFile, 'not gzip', { mode: 0o600 });
  const invalid = await run('project-invalid-gzip', 'bash', ['deploy/restore.sh', invalidFile], { input: 'yes\n' });
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.stderr, /not a valid gzip archive/);

  const restore = await run('project-valid-restore', 'bash', ['deploy/restore.sh', dumpFile], { input: 'yes\n' });
  const restored = await fingerprint(destination);
  const scriptRoundtrip = before.every(row => restored.some(other =>
    other.table === row.table && other.sha256 === row.sha256));
  console.log(JSON.stringify({ projectRestoreExit: restore.code,
    projectRoundtripEqual: scriptRoundtrip, restoredApplicationTables: restored.filter(row => row.table !== 'audit_restore_probe').length }));

  // A known-correct psql invocation is a fixture/control, not a pass for the
  // shipped restore script. It lets the audit check dump integrity separately.
  const control = await run('control-restore-with-file-stdin', 'psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '--file=-', destinationUrl,
  ], { input: dump });
  assert.equal(control.code, 0);
  const controlRows = (await fingerprint(destination)).filter(row => row.table !== 'audit_restore_probe');
  assert.deepEqual(controlRows, before, 'all 40 restored public tables match the original dump source');

  const failingSql = "UPDATE audit_restore_probe SET value = 'changed';\nSELECT 1/0;\n";
  const failingFile = path.join(folder, 'sql-error.sql.gz');
  await fs.writeFile(failingFile, gzipSync(failingSql), { mode: 0o600 });
  const failedProject = await run('project-sql-error', 'bash', ['deploy/restore.sh', failingFile], { input: 'yes\n' });
  const failedControl = await run('control-sql-error-with-file-stdin', 'psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '--file=-', destinationUrl,
  ], { input: failingSql });
  assert.equal(failedControl.code, 3);
  assert.match(failedControl.stderr, /division by zero/);
  const marker = (await destination.query('SELECT value FROM audit_restore_probe')).rows[0].value;
  assert.equal(marker, 'original', 'control SQL-error transaction rolls back');
  assert.deepEqual(await fingerprint(source), before, 'working audit evidence database was never restored over');
  console.log(JSON.stringify({ backupIntegrity: '40 table fingerprints match using control restore',
    gzipRejection: true, projectSqlErrorExit: failedProject.code,
    projectReachedSqlError: /division by zero/.test(failedProject.stderr),
    controlSqlErrorExit: failedControl.code, controlRollbackMarker: marker,
    sourceUnchanged: true, disposableDatabase: name }, null, 2));
  assert.equal(restore.code, 0, 'the shipped restore must accept a valid backup');
  assert.equal(scriptRoundtrip, true);
} finally {
  await destination.end();
  if (created) assert.equal((await run('drop-disposable', 'dropdb', ['--maintenance-db', databaseUrl, name])).code, 0);
  await source.end();
  await fs.writeFile(path.join(folder, 'commands.json'), JSON.stringify(outcomes, null, 2));
}
