// The student's score history under the schema-4 model: one row per SESSION
// (the timeline), columns are parameters, and each cell carries BOTH
// dimensions plus its answered state. A member row shadows the whole-group
// row of the same session × parameter — the student's own cell wins.

export function buildHistory({ evaluations, parameters }) {
  const byCell = new Map(); // `sessionId:parameterId` → cell
  const sessions = new Map(); // sessionId → row

  function ensureSession(item) {
    let row = sessions.get(item.sessionId);
    if (!row) {
      row = {
        sessionId: item.sessionId,
        sessionDate: item.sessionDate,
        sessionCode: item.sessionCode,
        assignmentId: item.assignmentId,
        cells: {},
      };
      sessions.set(item.sessionId, row);
    }
    return row;
  }

  // Member rows first so they overwrite any group row already recorded;
  // group rows only fill cells the member has not filled themselves.
  for (const item of evaluations) {
    if (item.membershipId === null) continue;
    ensureSession(item);
    byCell.set(`${item.sessionId}:${item.parameterId}`, {
      quality: item.qualityValue,
      quantity: item.quantityValue,
      qualityComment: item.qualityComment,
      quantityComment: item.quantityComment,
      answered:
        item.qualityValue !== null ||
        item.quantityValue !== null ||
        item.qualityComment !== null ||
        item.quantityComment !== null,
      viaGroup: false,
    });
  }
  for (const item of evaluations) {
    if (item.membershipId !== null) continue;
    const key = `${item.sessionId}:${item.parameterId}`;
    if (byCell.has(key)) continue; // the member's own row shadows the group's
    ensureSession(item);
    byCell.set(key, {
      quality: item.qualityValue,
      quantity: item.quantityValue,
      qualityComment: item.qualityComment,
      quantityComment: item.quantityComment,
      answered:
        item.qualityValue !== null ||
        item.quantityValue !== null ||
        item.qualityComment !== null ||
        item.quantityComment !== null,
      viaGroup: true,
    });
  }

  const scoredIds = new Set(evaluations.map((item) => item.parameterId));
  const columns = parameters.filter((parameter) => scoredIds.has(parameter.id));

  const rows = [...sessions.values()].sort(
    (a, b) =>
      String(a.sessionDate).localeCompare(String(b.sessionDate)) ||
      String(a.sessionCode).localeCompare(String(b.sessionCode))
  );
  for (const row of rows) {
    for (const parameter of columns) {
      const key = `${row.sessionId}:${parameter.id}`;
      if (byCell.has(key)) {
        row.cells[parameter.id] = { state: 'value', ...byCell.get(key) };
      } else {
        row.cells[parameter.id] = { state: 'none' };
      }
    }
  }

  return { columns, rows };
}

// Without "show all", the timeline starts at the first session where any of
// the student's cells was actually answered.
export function visibleRows(rows, showAll) {
  if (showAll || rows.length === 0) return rows;
  const first = rows.findIndex((row) =>
    Object.values(row.cells).some((cell) => cell.state === 'value' && cell.answered)
  );
  return first === -1 ? rows.slice(-1) : rows.slice(first);
}
