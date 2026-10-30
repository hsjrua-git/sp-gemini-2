import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const original = JSON.parse(await fs.readFile('audit/stage2-final-local/preservation.txt', 'utf8'));
for (const entry of original.suppliedCurrentHashes) {
  assert.equal(hash(await fs.readFile(entry.path)), entry.sha256, entry.path);
}
const captures = JSON.parse(await fs.readFile('audit/workflows-2026-10-30/captured-files.json', 'utf8'));
for (const entry of captures) {
  assert.equal(hash(await fs.readFile(`audit/workflows-2026-10-30/${entry.file}`)), entry.sha256, entry.file);
}
console.log(`PASS ${original.suppliedCurrentHashes.length} supplied handoff/schema files and ${captures.length} original workflow captures retain their recorded hashes`);
