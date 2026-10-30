// The Export Center's data source under the schema-4 model. Where
// /api/results serves one assignment-period grid at a time, the cube serves an
// arbitrary slice — any set of students × parameters × assignment-periods (or
// a session-date range) — in one request. Whole-group evaluation rows are
// expanded per current member by the route (with the member's own row
// shadowing the group row), so every cell here is strictly student-shaped.
//
// Pure so it can be unit tested without a database; the route owns the SQL
// and hands the rows over. Same student cap as results so a huge roster can't
// be pulled in one shot.
export const MAX_EXPORT_STUDENTS = 5000;

export function buildCube({
  parameters,
  students,
  assignments,
  periods,
  cells,
  selectedParameterIds,
}) {
  const activeIds = new Set(students.map((student) => student.id));

  // Which parameters actually carry a cell somewhere in the requested slice —
  // so "all" columns include a parameter that was evaluated even if it has
  // since been archived.
  const scoredInRange = new Set();
  for (const cell of cells) {
    if (!activeIds.has(cell.studentId)) continue;
    scoredInRange.add(cell.parameterId);
  }

  let columns;
  if (selectedParameterIds) {
    const selected = new Set(selectedParameterIds);
    columns = parameters.filter((parameter) => selected.has(parameter.id));
  } else {
    columns = parameters.filter(
      (parameter) => !parameter.archivedAt || scoredInRange.has(parameter.id)
    );
  }
  const columnSet = new Set(columns.map((parameter) => parameter.id));

  const keptCells = cells.filter(
    (cell) => activeIds.has(cell.studentId) && columnSet.has(cell.parameterId)
  );

  return {
    parameters: columns.map((parameter) => ({
      id: parameter.id,
      code: parameter.code,
      name: parameter.name,
      minValue: parameter.minValue,
      maxValue: parameter.maxValue,
    })),
    students: students.map((student) => ({
      id: student.id,
      fullName: student.fullName,
      studentCode: student.studentCode,
    })),
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      code: assignment.code,
      name: assignment.name,
    })),
    periods,
    cells: keptCells,
  };
}
