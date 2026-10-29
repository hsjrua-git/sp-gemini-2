import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Record an actual full read, not a scan. Only pass paths whose full contents
// have been inspected. Historical entries come from the saved conversation.
const root = path.resolve(import.meta.dirname, '..');
const [source, ...paths] = process.argv.slice(2);
if (!['checkpoint', 'current'].includes(source) || !paths.length) {
  throw new Error('Usage: node audit/record-review.mjs checkpoint|current PATH...');
}
const file = path.join(root, 'audit/inventory.json');
const inventory = JSON.parse(await fs.readFile(file, 'utf8'));
for (const name of paths) {
  const entry = inventory.files.find(item => item.path === name);
  if (!entry) throw new Error(`Path absent from initial inventory: ${name}`);
  if (entry.kind !== 'text') throw new Error(`Not ordinary text: ${name}`);
  const bytes = await fs.readFile(path.join(root, name));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== entry.sha256) throw new Error(`Changed since initial inventory: ${name}`);
  entry.review = 'fully read';
  entry.reviewEvidence = source === 'checkpoint'
    ? 'Full read recorded in the saved audit conversation before resumption.'
    : 'Full read in the resumed audit tool history.';
  entry.reviewRecordedAt = new Date().toISOString();
}
await fs.writeFile(file, JSON.stringify(inventory, null, 2) + '\n');
const reviewed = inventory.files.filter(item => item.review === 'fully read');
console.log(JSON.stringify({ newlyRecorded: paths.length, fullyRead: reviewed.length,
  totalInventory: inventory.files.length, fullyReadTextLines: reviewed.reduce((n, item) => n + item.lines, 0) }));
