// The client-side view of the export cube under the schema-4 model. The
// server hands back a flat list of student-shaped cells (whole-group rows
// already expanded per member, with the member's own row shadowing the group
// row per session) plus the period buckets they belong to; this turns them
// into a lookup keyed by student × parameter × assignment-period, picks ONE
// dimension (quality | quantity) as the value column, and applies the
// optional numeric filters.
//
// A period bucket can hold several sessions, so a (student, parameter,
// period) key can carry several cells; the LATEST session in the bucket wins
// (the most recent evaluation of that period). The previous-value lookup uses
// the same assignment's previous seq.
//
// Filter semantics: a filter narrows the ROSTER, judged against the student's
// value in the LAST period of the export (the most recent slice it covers) —
// mirroring the Results grid, where filters test one period's values. Reuses
// the same operator set as resultsView so a filter carried in from Results
// behaves identically.

const COMPARE = {
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  eq: (a, b) => a === b,
};

function round(number) {
  return Math.round(number * 100) / 100;
}

export function periodKey(assignmentId, seq) {
  return `${assignmentId}:${seq}`;
}

export function buildCube({
  periods = [],
  parameters = [],
  students = [],
  assignments = [],
  cells = [],
  filters = [],
  dimension = 'quality',
}) {
  const dim = dimension === 'quantity' ? 'quantity' : 'quality';

  // Normalize the period buckets: one entry per (assignment, seq), labelled
  // from the assignment list, ordered by start date.
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const buckets = [...new Map(
    periods.map((period) => [
      periodKey(period.assignmentId, period.seq),
      {
        key: periodKey(period.assignmentId, period.seq),
        assignmentId: period.assignmentId,
        seq: period.seq,
        startDate: period.startDate,
        endDate: period.endDate,
        label: `${assignmentById.get(period.assignmentId)?.name ?? assignmentById.get(period.assignmentId)?.code ?? period.assignmentId} · ${period.seq}`,
      },
    ])
  ).values()].sort((a, b) =>
    String(a.startDate).localeCompare(String(b.startDate)) || a.seq - b.seq
  );
  const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  // Latest non-null session wins inside a bucket; a member's own cell beats a
  // group cell across the bucket.
  const latestByKey = new Map(); // `${studentId}:${parameterId}:${bucketKey}` → cell
  const sortedCells = cells.slice().sort((a, b) => {
    const cmp = String(a.sessionDate).localeCompare(String(b.sessionDate));
    if (cmp !== 0) return cmp;
    if (a.viaGroup !== b.viaGroup) return a.viaGroup ? -1 : 1;
    return 0;
  });
  for (const cell of sortedCells) {
    const bucket = bucketByKey.get(periodKey(cell.assignmentId, cell.periodSeq));
    if (!bucket) continue;
    const key = `${cell.studentId}:${cell.parameterId}:${bucket.key}`;
    const existing = latestByKey.get(key);
    if (!existing) {
      latestByKey.set(key, { ...cell });
      continue;
    }
    if (existing.viaGroup && !cell.viaGroup) {
      latestByKey.set(key, {
        ...cell,
        quality: cell.quality !== null && cell.quality !== undefined ? cell.quality : existing.quality,
        quantity: cell.quantity !== null && cell.quantity !== undefined ? cell.quantity : existing.quantity,
        viaGroup: false,
      });
    } else if (existing.viaGroup === Boolean(cell.viaGroup)) {
      latestByKey.set(key, {
        ...existing,
        ...cell,
        quality: cell.quality !== null && cell.quality !== undefined ? cell.quality : existing.quality,
        quantity: cell.quantity !== null && cell.quantity !== undefined ? cell.quantity : existing.quantity,
      });
    }
  }

  const valueAt = (studentId, parameterId, key) => {
    const cell = latestByKey.get(`${studentId}:${parameterId}:${key}`);
    const value = cell === undefined ? undefined : cell[dim];
    return value === undefined ? null : value;
  };

  // The previous bucket of the SAME assignment (seq − 1); missing → null.
  const previousKeyOf = (key) => {
    const bucket = bucketByKey.get(key);
    if (!bucket) return null;
    const candidate = periodKey(bucket.assignmentId, bucket.seq - 1);
    return bucketByKey.has(candidate) ? candidate : null;
  };

  const cellAt = (studentId, parameterId, key) => {
    const value = valueAt(studentId, parameterId, key);
    const previousKey = previousKeyOf(key);
    const previous = previousKey === null ? null : valueAt(studentId, parameterId, previousKey);
    const delta =
      value !== null && previous !== null ? round(value - previous) : null;
    return { value, previous, delta };
  };

  const lastPeriod =
    buckets.length === 0
      ? null
      : buckets.reduce((last, bucket) =>
          String(bucket.endDate).localeCompare(String(last.endDate)) > 0 ||
          (bucket.endDate === last.endDate && bucket.seq > last.seq)
            ? bucket
            : last
        );

  const passes = (student, filter) => {
    const value =
      lastPeriod === null ? null : valueAt(student.id, filter.parameterId, lastPeriod.key);
    const has = value !== null;
    if (filter.op === 'missing') return !has;
    if (filter.op === 'present') return has;
    if (!has) return false;
    const compare = COMPARE[filter.op];
    return compare ? compare(value, filter.value) : true;
  };

  const filteredStudents = students.filter((student) =>
    filters.every((filter) => passes(student, filter))
  );

  return {
    dimension: dim,
    periods: buckets,
    parameters,
    assignments,
    students: filteredStudents,
    lastPeriod,
    valueAt,
    cellAt,
  };
}

// Cohort average of one parameter across every period in the cube: one point
// per period carrying the mean of all (filtered) students' values that period
// and the count behind it. Missing values are skipped; a period with no
// scores yields `average: null`, `count: 0`. Feeds the trend and comparison
// charts.
export function cohortAverages(cube, parameterId) {
  return cube.periods.map((period) => {
    const values = cubeValues(cube, parameterId, period.key);
    const average = values.length
      ? round(values.reduce((total, value) => total + value, 0) / values.length)
      : null;
    return { period, average, count: values.length };
  });
}

// Every non-null value recorded for a parameter in one period, across the
// cube's (filtered) students. Feeds the distribution chart.
export function cubeValues(cube, parameterId, periodKey) {
  const values = [];
  for (const student of cube.students) {
    const value = cube.valueAt(student.id, parameterId, periodKey);
    if (value !== null) values.push(value);
  }
  return values;
}
