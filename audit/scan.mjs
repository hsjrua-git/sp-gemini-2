import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const inventory = JSON.parse(await fs.readFile(path.join(root, 'audit/inventory.json'), 'utf8'));
const findings = [];
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['provider-token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})/g],
  ['credential-url', /(?:postgres(?:ql)?|mysql|https?):\/\/[^\s/:]+:[^\s/@]+@[^\s'"`]+/g],
];
function scan(text, file, commit = 'working-tree') {
  for (const [kind, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      findings.push({ commit, file, line: text.slice(0, match.index).split('\n').length, kind,
        status: 'candidate; inspect without exposing value' });
    }
  }
}
const source = new Map();
for (const file of inventory.files) {
  if (file.kind !== 'text' || !file.tracked) continue;
  const text = await fs.readFile(path.join(root, file.path), 'utf8');
  scan(text, file.path);
  if (/\.(?:js|jsx|mjs)$/.test(file.path)) source.set(file.path, text);
}
const commits = execFileSync('git', ['rev-list', '--all'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
for (const commit of commits) {
  const files = execFileSync('git', ['ls-tree', '-rz', '--name-only', commit], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of files) {
    if (/\.(?:png|jpe?g|woff2?|zip|jar)$/.test(file)) continue;
    const data = execFileSync('git', ['show', `${commit}:${file}`], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
    if (!data.includes(0)) scan(data.toString('utf8'), file, commit);
  }
}
const referenced = new Set();
const missing = [];
for (const [file, text] of source) {
  for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    if (inventory.files.some(f => f.path === resolved)) referenced.add(resolved);
    else missing.push({ file, specifier, status: 'SUSPECTED; regex import scan only' });
  }
}
const roots = new Set(['server/src/index.js', 'client/src/main.jsx', 'agent/src/index.js']);
const unreferenced = [...source.keys()].filter(file => !referenced.has(file) && !roots.has(file)
  && !/(?:test|scripts|config|verifyPglite|migrate)/.test(file));
const result = { method: 'Credential-pattern scan of tracked text in working tree and every reachable commit; regex import graph. This is not a comprehensive secret detector or dead-code proof.',
  commits: commits.length, trackedSourceFiles: source.size, secretCandidates: findings,
  missingRelativeImports: missing, unreferencedCandidates: unreferenced,
  typeCheck: 'No type-check script or TypeScript configuration in any package; lint and build are separate checks.' };
await fs.writeFile(path.join(root, 'audit/scan.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
