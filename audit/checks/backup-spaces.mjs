import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { databaseUrl } from './isolated.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const scratch = await fs.mkdtemp(path.join(root, 'audit/runtime/backup-check-'));
const backups = path.join(scratch, 'backups with spaces');
const sentinel = path.join(scratch, 'backups');
const oldDump = path.join(backups, 'student-panel-20000101-000000.sql.gz');
try {
  await fs.mkdir(backups);
  await fs.writeFile(sentinel, 'Unrelated file: retention must never remove this.');
  await fs.writeFile(oldDump, gzipSync('-- old audit fixture'));
  await fs.utimes(oldDump, new Date('2000-01-01'), new Date('2000-01-01'));
  const result = spawnSync('bash', [path.join(root, 'deploy/backup.sh')], {
    cwd: scratch, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, DATABASE_URL: databaseUrl, BACKUP_DIR: backups, KEEP: '1' },
  });
  const exists = file => fs.access(file).then(() => true, () => false);
  const observed = {
    exit: result.status,
    unrelatedFilePreserved: await exists(sentinel),
    expiredDumpRemoved: !(await exists(oldDump)),
    remainingDumps: (await fs.readdir(backups)).filter(name => name.endsWith('.sql.gz')).length,
  };
  console.log(JSON.stringify(observed, null, 2));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(observed.unrelatedFilePreserved, true, 'retention must preserve unrelated files');
  assert.equal(observed.expiredDumpRemoved, true, 'retention must prune the actual old dump');
  assert.equal(observed.remainingDumps, 1);
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
