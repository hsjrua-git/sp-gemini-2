import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Read-only reconciliation. Never rebuild the inventory or relabel unread files.
const root = path.resolve(import.meta.dirname, '../..');
const inventory = JSON.parse(await fs.readFile(path.join(root, 'audit/inventory.json'), 'utf8'));
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const missingTracked = tracked.filter(name => !inventory.files.some(f => f.path === name));
const hashes = { checked: 0, changed: [], missing: [], secretFilesNotOpened: [] };
const remaining = [];
for (const entry of inventory.files) {
  if (entry.kind === 'secret-config') hashes.secretFilesNotOpened.push(entry.path);
  else {
    try {
      const data = await fs.readFile(path.join(root, entry.path));
      hashes.checked++;
      if (createHash('sha256').update(data).digest('hex') !== entry.sha256) hashes.changed.push(entry.path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hashes.missing.push(entry.path);
    }
  }
  if (entry.review === 'fully read') continue;
  let scope;
  if (entry.kind === 'secret-config') scope = 'secret configuration: contents intentionally unopened';
  else if (entry.kind === 'lockfile') scope = 'dependency metadata: structured inspection, not a full source read';
  else if (entry.path.startsWith('client/android/app/src/main/assets/public/')) scope = 'generated mobile web bundle: no decompiled source review or device assurance';
  else if (entry.kind === 'binary') scope = 'binary asset or wrapper: hash only, not a source read';
  else if (entry.path === 'server/server.log' || entry.path.startsWith('agent/logs/')) scope = 'pre-existing runtime log: outside source review';
  else scope = 'OUTSTANDING SOURCE READ';
  remaining.push({ path: entry.path, tracked: entry.tracked, kind: entry.kind, scope });
}
const dependencies = [];
for (const name of ['agent', 'client', 'server']) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, name, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(root, name, 'package-lock.json'), 'utf8'));
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.name, pkg.name);
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    assert.deepEqual(lock.packages[''][key] ?? {}, pkg[key] ?? {});
  }
  const records = Object.entries(lock.packages).filter(([key]) => key);
  const anomalous = records.filter(([, p]) => {
    if (p.link) return true;
    if (!p.resolved || !p.integrity) return true;
    const url = new URL(p.resolved);
    return url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || !!url.username || !!url.password;
  }).map(([key]) => key);
  dependencies.push({ package: name, lockfileVersion: lock.lockfileVersion, rootRangesMatch: true,
    records: records.length, devOnly: records.filter(([, p]) => p.dev).length,
    installScripts: records.filter(([, p]) => p.hasInstallScript).map(([key]) => key),
    anomalousResolutionOrIntegrity: anomalous });
}
const reviewed = inventory.files.filter(f => f.review === 'fully read');
const summary = {
  baseline: inventory.commit, inventoryFiles: inventory.files.length,
  trackedFiles: tracked.length, missingTracked,
  fullyReadFiles: reviewed.length, fullyReadTextLines: reviewed.reduce((n, f) => n + f.lines, 0),
  trackedTextFiles: inventory.files.filter(f => f.tracked && f.kind === 'text').length,
  outstandingSourceReads: remaining.filter(f => f.scope === 'OUTSTANDING SOURCE READ'),
  remainingByScope: Object.fromEntries([...new Set(remaining.map(f => f.scope))].map(scope =>
    [scope, remaining.filter(f => f.scope === scope).length])),
  hashes, dependencies, remaining,
};
console.log(JSON.stringify(summary, null, 2));
assert.deepEqual(missingTracked, []);
assert.deepEqual(summary.outstandingSourceReads, []);
assert.deepEqual(hashes.changed, []);
assert.deepEqual(hashes.missing, []);
for (const dependency of dependencies) assert.deepEqual(dependency.anomalousResolutionOrIntegrity, []);
