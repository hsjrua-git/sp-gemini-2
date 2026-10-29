import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean));
const files = [];
const omitted = [];
async function walk(relative = '') {
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'dist', 'audit'].includes(entry.name)) {
        omitted.push({ path: name, reason: entry.name === 'audit' ? 'audit-generated evidence' : 'generated/dependency/git internals' });
      } else await walk(name);
    } else if (entry.isFile()) {
      const data = await fs.readFile(path.join(root, name));
      const binary = data.includes(0) || /\.(woff2?|png|jpg|zip|pdf)$/.test(name);
      files.push({ path: name, tracked: tracked.has(name), bytes: data.length,
        lines: binary ? null : data.toString('utf8').split('\n').length,
        sha256: createHash('sha256').update(data).digest('hex'),
        kind: binary ? 'binary' : name.includes('package-lock.json') ? 'lockfile' : /(^|\/)\.env($|\.)/.test(name) && !name.endsWith('.example') ? 'secret-config' : 'text',
        review: 'not reviewed' });
    } else omitted.push({ path: name, reason: 'non-regular file; not followed' });
  }
}
await walk();
files.sort((a, b) => a.path.localeCompare(b.path));
const result = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), files, omitted };
await fs.writeFile(path.join(root, 'audit/inventory.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ files: files.length, tracked: files.filter(f => f.tracked).length,
  textLines: files.filter(f => f.kind === 'text').reduce((n, f) => n + f.lines, 0), omitted }, null, 2));
