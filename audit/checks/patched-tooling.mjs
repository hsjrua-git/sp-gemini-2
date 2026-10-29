import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const before = JSON.parse(execFileSync('git', ['show', 'a4d81f0:client/package-lock.json'], { encoding: 'utf8' }));
const after = JSON.parse(fs.readFileSync('client/package-lock.json'));
// User authorized the required transitive exceptions after reviewing the
// patch-only boundary. These are pinned by their updated tooling parents.
const requiredExceptions = {
  'node_modules/@oxc-project/types': ['0.150.0', '0.156.0'],
  'node_modules/why-is-node-running': ['2.3.0', '3.2.1'],
};
const removed = new Set(['node_modules/siginfo', 'node_modules/stackback']);
assert.equal(after.packages['node_modules/rolldown'].dependencies['@oxc-project/types'], '=0.156.0');
assert.equal(after.packages['node_modules/vitest'].dependencies['why-is-node-running'], '3.2.1');
for (const key of new Set([...Object.keys(before.packages), ...Object.keys(after.packages)])) {
  const a = before.packages[key], b = after.packages[key];
  if (JSON.stringify(a) === JSON.stringify(b)) continue;
  console.log(JSON.stringify({ path: key, from: a?.version, to: b?.version,
    changedKeys: [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
      .filter(k => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) }));
  if (requiredExceptions[key]) assert.deepEqual([a?.version, b?.version], requiredExceptions[key]);
  else if (a?.version && b?.version) assert.equal(a.version.split('.').slice(0, 2).join('.'), b.version.split('.').slice(0, 2).join('.'), 'patch-only outside approved exceptions');
  else assert.ok(a && !b && removed.has(key), `unexpected addition/removal: ${key}`);
  if (a && b) assert.equal(a.license, b.license);
  if (b?.resolved) assert.ok(b.resolved.startsWith('https://registry.npmjs.org/'));
}
for (const [name, version] of Object.entries({ vite: '8.3.3', vitest: '5.0.3', '@vitest/mocker': '5.0.3', 'source-map-js': '1.2.2', zod: '4.6.7' })) {
  assert.equal(after.packages[`node_modules/${name}`].version, version);
}
console.log('Patch updates plus two approved required transitive exceptions; registry and license checks pass.');
