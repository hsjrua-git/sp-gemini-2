import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';

const script = fileURLToPath(new URL('../../deploy/backup.sh', import.meta.url));
const skip = process.platform === 'win32' ? 'POSIX deployment script' : false;

async function fixture(t, directory = 'backups with spaces') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-retention-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const backups = path.join(root, directory);
  const bin = path.join(root, 'bin');
  await fs.mkdir(backups);
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'pg_dump'), '#!/bin/sh\nprintf "%s\\n" "-- fixture dump"\n', { mode: 0o700 });
  const sentinel = path.join(root, 'backups');
  await fs.writeFile(sentinel, 'unrelated');
  async function oldDump(name, date) {
    const file = path.join(backups, name);
    await fs.writeFile(file, gzipSync(name));
    await fs.utimes(file, new Date(date), new Date(date));
    return file;
  }
  function run(keep) {
    return spawnSync('bash', [script], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        DATABASE_URL: 'postgresql://unused-by-fixture', BACKUP_DIR: backups, KEEP: String(keep) },
    });
  }
  return { backups, bin, sentinel, oldDump, run };
}

for (const directory of ['backups with spaces', 'backups\twith\nlines and \'quotes\'']) {
  test(`backup retention preserves path boundaries: ${JSON.stringify(directory)}`, { skip }, async t => {
    const f = await fixture(t, directory);
    // Names deliberately disagree with modification order: retention is by mtime.
    await f.oldDump('student-panel-z-old.sql.gz', '2000-01-01');
    const recent = await f.oldDump('student-panel-a-newer.sql.gz', '2001-01-01');
    await fs.writeFile(path.join(f.backups, 'unrelated.sql.gz'), 'unrelated backup');
    const result = f.run(2);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await fs.readFile(f.sentinel, 'utf8'), 'unrelated');
    const names = await fs.readdir(f.backups);
    assert.equal(names.includes('student-panel-z-old.sql.gz'), false);
    assert.equal(names.includes(path.basename(recent)), true);
    assert.equal(names.includes('unrelated.sql.gz'), true);
    const dumps = names.filter(name => name.startsWith('student-panel-'));
    assert.equal(dumps.length, 2);
    const created = dumps.find(name => name !== path.basename(recent));
    assert.equal(gunzipSync(await fs.readFile(path.join(f.backups, created))).toString(), '-- fixture dump\n');
  });
}

test('KEEP=0 prunes all completed dumps but preserves unrelated files', { skip }, async t => {
  const f = await fixture(t);
  await f.oldDump('student-panel-old.sql.gz', '2000-01-01');
  const result = f.run(0);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await fs.readdir(f.backups), []);
  assert.equal(await fs.readFile(f.sentinel, 'utf8'), 'unrelated');
});

test('failed dump preserves existing backups and removes its temporary file', { skip }, async t => {
  const f = await fixture(t);
  const old = await f.oldDump('student-panel-old.sql.gz', '2000-01-01');
  const before = await fs.readFile(old);
  await fs.writeFile(path.join(f.bin, 'pg_dump'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  assert.notEqual(f.run(0).status, 0);
  assert.deepEqual(await fs.readdir(f.backups), [path.basename(old)]);
  assert.deepEqual(await fs.readFile(old), before);
});
