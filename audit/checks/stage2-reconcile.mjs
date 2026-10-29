import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Read-only closing check. Baseline hashes and failing outputs stay historical.
const stage1 = 'a67143e';
const baseline = 'a4d81f07d2e016341310dc8df79b9c878cf32ada';
const git = (...args) => execFileSync('git', args);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inventoryBytes = await fs.readFile('audit/inventory.json');
assert.deepEqual(inventoryBytes, git('show', `${stage1}:audit/inventory.json`));
const inventory = JSON.parse(inventoryBytes);
const committedPaths = new Set(git('diff', '--name-only', '-z', baseline, 'HEAD').toString().split('\0').filter(Boolean));
const localAndroid = 'client/android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java';
const changed = [], missing = [], unexpected = [], untouched = [];
let checked = 0;
for (const entry of inventory.files) {
  if (entry.kind === 'secret-config') continue;
  let bytes;
  try { bytes = await fs.readFile(entry.path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; missing.push(entry.path); continue; }
  checked++;
  if (hash(bytes) === entry.sha256) untouched.push(entry.path);
  else {
    changed.push(entry.path);
    if (!committedPaths.has(entry.path) && entry.path !== localAndroid) unexpected.push(entry.path);
  }
}
const protectedPaths = git('ls-tree', '-r', '--name-only', '-z', stage1, 'audit').toString()
  .split('\0').filter(name => /^audit\/(baseline|continuation-\d+|stage1-final)\//.test(name));
const changedEvidence = [];
for (const name of protectedPaths) {
  if (!Buffer.from(await fs.readFile(name)).equals(git('show', `${stage1}:${name}`))) changedEvidence.push(name);
}
const providedPaths = ['audit/HANDOFF.md', 'audit/HANDOFF_COMPARISON.md', 'audit/HANDOFF_CONSOLIDATED.md',
  ...inventory.files.filter(entry => entry.path.startsWith('partly-schema/')).map(entry => entry.path)];
const supplied = [];
for (const name of providedPaths) supplied.push({ path: name, sha256: hash(await fs.readFile(name)) });
const trackedProvided = git('ls-files', '--', ...providedPaths).toString().trim();
const summary = {
  baseline, reviewedFixHead: git('rev-parse', 'HEAD').toString().trim(),
  branch: git('branch', '--show-current').toString().trim(),
  inventoryByteIdenticalToStage1: true, checkedNonSecret: checked,
  unchanged: untouched.length, changedByCommittedFixOrA06: changed,
  missing, unexpected, protectedOriginalEvidenceFiles: protectedPaths.length, changedEvidence,
  suppliedCurrentHashes: supplied, suppliedTracked: trackedProvided,
  secretFilesNotOpened: inventory.files.filter(e => e.kind === 'secret-config').map(e => e.path),
};
console.log(JSON.stringify(summary, null, 2));
assert.equal(summary.branch, 'audit-fixes');
assert.equal(checked, 629);
assert.deepEqual(missing, []);
assert.deepEqual(unexpected, []);
assert.deepEqual(changedEvidence, []);
assert.equal(trackedProvided, '');
assert.ok(inventory.files.filter(e => e.path.startsWith('partly-schema/')).every(e => untouched.includes(e.path)));
