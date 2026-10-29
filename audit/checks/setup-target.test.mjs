import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
for (const sudo of ['available', 'unavailable']) {
  test(`installer respects configured PostgreSQL endpoint with sudo ${sudo}`, { skip: process.platform !== 'linux' }, async () => {
    const folder = await fs.mkdtemp(path.join(root, 'audit/.tmp/setup-target-'));
    const bin = path.join(folder, 'bin');
    await fs.mkdir(bin);
    await fs.mkdir(path.join(folder, 'scripts'));
    await fs.mkdir(path.join(folder, 'server'));
    const source = await fs.readFile(path.join(root, 'scripts/setup.mjs'));
    const copy = path.join(folder, 'scripts/setup.mjs');
    await fs.writeFile(copy, source);
    assert.deepEqual(await fs.readFile(copy), source);
    // Synthetic configuration, no real credential or .env is read by the child.
    await fs.writeFile(path.join(folder, 'server/.env'),
      'DATABASE_URL=postgres://audit_fake@127.0.0.1:55439/audit_fake\nPORT=3300\nHOST=127.0.0.1\n', { mode: 0o600 });
    const dispatcher = await fs.readFile(path.join(root, 'audit/checks/setup-target-dispatcher.mjs'), 'utf8');
    for (const name of ['sudo', 'psql', 'npm']) {
      await fs.writeFile(path.join(bin, name), `#!${process.execPath}\n${dispatcher}`, { mode: 0o700 });
    }
    const log = path.join(folder, 'dispatch.jsonl');
    const result = spawnSync(process.execPath, [copy, '--yes'], {
      cwd: folder, encoding: 'utf8', timeout: 15000,
      env: { PATH: bin, AUDIT_SUDO: sudo, AUDIT_DISPATCH_LOG: log,
        AUDIT_DISPATCH_STATE: path.join(folder, 'state.json') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(result.error, undefined);
    const events = (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const bootstraps = events.filter(event => event.operation === 'bootstrap role and database');
    assert.equal(bootstraps.length, 1, 'actually dispatched bootstrap SQL exactly once');
    const connections = events.filter(event => event.operation === 'application connection');
    console.log(JSON.stringify({ sudo, copiedSourceSha256: createHash('sha256').update(source).digest('hex'),
      installerExit: result.status, events, output: (result.stdout + result.stderr).replace(/\x1b\[[0-9;]*m/g, '') }));
    // On failure setup makes a third connection solely to print diagnostics.
    assert.ok(connections.length >= 2, 'initial and post-bootstrap connection attempts both executed');
    assert.equal(connections[0].reachable, false);
    assert.ok(connections.every(event => event.target === '127.0.0.1:55439'));
    assert.equal(bootstraps[0].target, '127.0.0.1:55439', 'bootstrap must use the configured endpoint');
    assert.equal(connections[1].reachable, true, 'application connection succeeds at configured endpoint');
  });
}
