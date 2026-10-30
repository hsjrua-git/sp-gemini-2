import { readReportResults } from './reportResults.js';

// Use exactly the same aggregation and historical membership as Results and
// Dashboard. Previous values travel as metadata, not extra visible periods.
export async function readReportExport(db, periodIds, { studentIds = [], parameterIds = [], from = null, to = null } = {}) {
  const report = await readReportResults(db, periodIds, { from, to });
  const students = new Map();
  const assignments = new Map();
  const cells = [];
  const periodStudents = {};
  for (const grid of report.grids) {
    assignments.set(grid.assignment.id, grid.assignment);
    periodStudents[`${grid.assignment.id}:${grid.period.seq}`] = [];
    for (const row of grid.rows.filter(row => !row.isGroup && (!studentIds.length || studentIds.includes(row.studentId)))) {
      students.set(row.studentId, { id: row.studentId, fullName: row.fullName, studentCode: row.studentCode });
      periodStudents[`${grid.assignment.id}:${grid.period.seq}`].push(row.studentId);
      for (const parameterId of new Set([...Object.keys(row.cells), ...Object.keys(row.previous)])) {
        const cell = row.cells[parameterId] ?? { quality: null, quantity: null };
        if (parameterIds.length && !parameterIds.includes(parameterId)) continue;
        cells.push({ ...cell, parameterId, studentId: row.studentId,
          assignmentId: grid.assignment.id, periodSeq: grid.period.seq,
          sessionDate: grid.period.endDate, previous: row.previous[parameterId] ?? null });
      }
    }
  }
  return { parameters: report.parameters.filter(p => !parameterIds.length || parameterIds.includes(p.id)),
    students: [...students.values()], assignments: [...assignments.values()],
    periods: report.grids.map(g => ({ ...g.period, assignmentId: g.assignment.id })), cells,
    periodStudents, total: students.size, truncated: false };
}
