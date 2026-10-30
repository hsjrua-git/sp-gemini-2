import { exportReportScope, savedReportScope } from './reportPrefill.js';

const assignmentId = '12345678-1234-1234-1234-123456789abc';
const periods = [1, 2].map(seq => ({ id: `p${seq}`, assignmentId, seq, sessionCount: 4 }));
const current = { groupIds: ['other'], assignmentIds: [], periodIds: [], dimensions: ['quality', 'quantity'] };

test('legacy explicit sequence links replace unrelated shared scope and resolve IDs', () => {
  expect(exportReportScope({ scope: { assignmentId, mode: 'selection', seqs: [2] } }, current, periods))
    .toEqual({ ...current, groupIds: [], assignmentIds: [assignmentId], periodIds: ['p2'] });
  expect(exportReportScope({ scope: { assignmentId, mode: 'selection', seqs: [3] } }, current, periods)).toBeNull();
});

test('legacy saved latest selects one latest period and missing sequences never mean all', () => {
  expect(savedReportScope({ assignmentId }, periods).periodIds).toEqual(['p2']);
  expect(savedReportScope({ assignmentId, seq: 3 }, periods)).toBeNull();
  expect(savedReportScope({ assignmentId }, [])).toBeNull();
});

test('student group links clear stale assignments and periods but preserve both dimensions', () => {
  expect(exportReportScope({ students: { mode: 'group', groupId: 'new' } }, current, periods))
    .toEqual({ ...current, groupIds: ['new'], assignmentIds: [], periodIds: [] });
});
