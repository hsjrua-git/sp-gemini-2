import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Papa from '../../client/node_modules/papaparse/papaparse.js';
import { api, login } from './isolated.mjs';

const call = api();
try {
  await login(call);
  const assignmentId = 'b61de193-487f-4f26-bf3b-5b30c691b50b';
  const all = await call('/api/export/cube', { method: 'POST', body: { assignmentId } });
  const selected = await call('/api/export/cube', { method: 'POST', body: { assignmentId, periods: [1] } });
  assert.equal(all.status, 200);
  assert.equal(selected.status, 200);
  assert.deepEqual(all.data.periods.map(p => p.seq).sort(), [1, 2]);
  // Live metadata covers the whole calendar, even when cells are narrowed.
  assert.deepEqual(selected.data.periods.map(p => p.seq).sort(), [1, 2]);
  assert.ok(selected.data.cells.length > 0);
  assert.ok(selected.data.cells.every(c => c.periodSeq === 1));
  const csv = Papa.parse(await fs.readFile(new URL('../continuation-09/selected-period-1-original.csv', import.meta.url), 'utf8'), { header: true, skipEmptyLines: true });
  assert.equal(csv.errors.length, 0);
  const labels = [...new Set(csv.data.map(row => row.Period))];
  console.log(JSON.stringify({ apiControl: 'explicit periods [1] filters successfully',
    allPeriods: all.data.periods.map(p => p.seq), selectedCellPeriods: [...new Set(selected.data.cells.map(c => c.periodSeq))],
    selectedCells: selected.data.cells.length, downloadedRowCount: csv.data.length, downloadedPeriods: labels }));
  // Regression assertion on the actual browser artifact; API above is the positive control.
  assert.deepEqual(labels, ['Sample — Group A weekly · 1']);
} finally { await call('/api/auth/logout', { method: 'POST' }); }
