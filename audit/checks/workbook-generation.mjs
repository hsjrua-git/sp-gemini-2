import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { buildWorkbookBlob } from '../../client/src/lib/xlsx.js';

// Exercise the actual lazy browser writer. Python's stdlib independently checks
// ZIP CRCs, relationship targets, XML, sheets and typed cell values.
const folder = new URL('../continuation-02/', import.meta.url);
await fs.mkdir(folder, { recursive: true });
const sheets = [
  { name: 'Typed cells', rows: [
    ['Text', 'Integer', 'Decimal', 'Boolean', 'Empty', 'Formula text', 'Negative'],
    ['دانش‌آموز & <score> "quoted"\nnext', 0, 1.005, true, null, '=1+1', -15],
    ['comma,semicolon;', 9007199254740991, 0.145, false, '', '+SUM(A1:A2)', -0.5],
    ['@name', -1, NaN, null, undefined, '-command', Infinity],
  ] },
  { name: 'Second sheet', rows: [['Name', 'Value'], ['دو', 8]] },
];
const blob = await buildWorkbookBlob(sheets);
assert.ok(blob instanceof Blob);
assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
const file = new URL('typed-workbook.xlsx', folder);
await fs.writeFile(file, Buffer.from(await blob.arrayBuffer()));
const result = spawnSync('python3', ['audit/checks/validate-workbook.py', file.pathname, 'typed'], { encoding: 'utf8' });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
assert.equal(result.status, 0, 'independent workbook validation must succeed');
