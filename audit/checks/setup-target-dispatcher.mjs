import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Audit-only substitutes. No real sudo, psql, package manager, or socket is used.
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const log = event => fs.appendFileSync(process.env.AUDIT_DISPATCH_LOG, JSON.stringify(event) + '\n');
if (args.includes('--version')) {
  console.log(`audit fake ${command}`);
  process.exit(0);
}
if (command === 'sudo') {
  log({ command, args });
  if (process.env.AUDIT_SUDO === 'unavailable') process.exit(1);
  if (args[0] !== '-u' || args[1] !== 'postgres' || args[2] !== 'psql') process.exit(98);
  const result = spawnSync(path.join(path.dirname(process.argv[1]), 'psql'), args.slice(3), {
    input: fs.readFileSync(0), encoding: 'utf8', env: process.env,
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  process.exit(result.status ?? 97);
}
if (command !== 'psql') process.exit(96);
const arg = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const host = arg('-h', process.env.PGHOST || 'local-socket');
const port = arg('-p', process.env.PGPORT || '5432');
const target = `${host}:${port}`;
const sql = args.includes('-tAc') ? args[args.indexOf('-tAc') + 1] : fs.readFileSync(0, 'utf8');
const stateFile = process.env.AUDIT_DISPATCH_STATE;
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
let operation;
if (sql.includes('CREATE ROLE') && sql.includes('CREATE DATABASE')) {
  operation = 'bootstrap role and database';
  state[target] = true;
  fs.writeFileSync(stateFile, JSON.stringify(state));
} else if (sql.includes('server_version_num')) {
  log({ command, args, target, operation: 'stop control after successful database setup' });
  console.error('Audit stop before configuration/dependency/build stages');
  process.exit(95);
} else if (sql.trim() === 'SELECT 1;') {
  operation = 'privileged probe';
} else if (sql.trim() === 'SELECT 1') {
  operation = 'application connection';
  log({ command, args, target, operation, reachable: Boolean(state[target]) });
  if (!state[target]) { console.error('Audit fake: application database absent at configured endpoint'); process.exit(1); }
  console.log('1');
  process.exit(0);
} else {
  log({ command, args, target, operation: 'unexpected SQL refused' });
  process.exit(94);
}
log({ command, args, target, operation });
console.log('1');
