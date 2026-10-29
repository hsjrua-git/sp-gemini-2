import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { baseUrl, databaseUrl } from './isolated.mjs';

// Run shared-database checks one at a time, against the already-seeded audit DB.
// Never load server/.env; no concurrent browser mutations while this is running.
const phase = process.argv[2];
if (!phase || !/^[\w-]+$/.test(phase)) throw new Error('Pass a new evidence phase.');
const root = path.resolve(import.meta.dirname, '../..');
const checks = [
  ['tests-permissions', 'test/permissions.test.js', ['--test']],
  ['smoke-cafe-stock', 'src/scripts/cafeStockSmoke.mjs', []],
  ['smoke-cafe-sales', 'src/scripts/cafeSalesSmoke.mjs', []],
  ['smoke-alerts', 'src/scripts/alertsSmoke.mjs', []],
  ['smoke-invariants', 'src/scripts/invariantRaceSmoke.mjs', []],
  ['smoke-accounting', 'src/scripts/accountingSmoke.mjs', []],
];
for (const [name, script, flags] of checks) {
  const result = spawnSync(process.execPath, [
    'audit/run-command.mjs', phase, name, 'server', process.execPath, ...flags, script,
  ], { cwd: root, stdio: 'inherit', env: { ...process.env,
    DATABASE_URL: databaseUrl, TEST_SERVER_URL: baseUrl,
    RUN_INTEGRATION: name === 'tests-permissions' ? '1' : '0',
  } });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
