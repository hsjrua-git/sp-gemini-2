// Keep assignment-period cells separate while merging duplicate students.
// Applicability is recorded per row so another group's parameters cannot make
// an unrelated student look incomplete.
export function scopedHistory(evaluations, periods) {
  const keys = new Set(periods.map(period => `${period.assignmentId}:${period.seq}`));
  return evaluations.filter(row => keys.has(`${row.assignmentId}:${row.periodSeq}`));
}

export function dashboardResults(data) {
  const parameters = [];
  const students = new Map();
  for (const grid of data.grids) {
    const inUse = data.parameters.filter(p => grid.rows.some(row => row.cells[p.id] !== undefined));
    const key = id => `${grid.period.id}:${id}`;
    for (const p of inUse) parameters.push({ ...p, id: key(p.id), originalId: p.id,
      parentId: p.parentId ? key(p.parentId) : null,
      name: `${grid.assignment.name || grid.assignment.code} · ${grid.period.seq} · ${p.path || p.name}`,
      assignmentId: grid.assignment.id, periodId: grid.period.id });
    for (const row of grid.rows.filter(r => !r.isGroup)) {
      if (!students.has(row.studentId)) students.set(row.studentId, { ...row, cells: {}, previous: {}, expectedParameterIds: [] });
      const target = students.get(row.studentId);
      target.expectedParameterIds.push(...inUse.map(p => key(p.id)));
      for (const p of inUse) {
        if (row.cells[p.id]) target.cells[key(p.id)] = row.cells[p.id];
        if (row.previous[p.id]) target.previous[key(p.id)] = row.previous[p.id];
      }
    }
  }
  return { parameters, rows: [...students.values()] };
}

export function selectedTrend(data, parameter, dimension) {
  return data.grids.filter(grid => grid.assignment.id === parameter.assignmentId).map(grid => {
    const values = grid.rows.filter(row => !row.isGroup).map(row => row.cells[parameter.originalId]?.[dimension]).filter(value => value != null);
    return { label: `${grid.assignment.name || grid.assignment.code} · ${grid.period.seq}`,
      average: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100 : null };
  });
}
