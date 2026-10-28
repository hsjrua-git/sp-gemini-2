// Per-view data shaping for the student's history (schema-4 model).
//
// periodView answers "what does this student carry in ONE assignment period"
// — per parameter: the viewed dimension's value (their own member cell, or
// the whole-group cell when they have none), its position within the
// parameter's range, and the change vs the assignment's previous period.
//
// parameterView answers "how did ONE parameter evolve" — the student's cells
// over session dates (member shadowing group), in the viewed dimension.

function round(number) {
  return Math.round(number * 100) / 100;
}

export function percentOfRange(value, minValue, maxValue) {
  if (value === null || minValue === null || maxValue === null) return null;
  if (maxValue <= minValue) return null;
  const percent = ((value - minValue) * 100) / (maxValue - minValue);
  return Math.min(100, Math.max(0, percent));
}

// `evaluations` = the student's rows (member + whole-group); `periods` = the
// assignment's materialized periods [{ seq, startDate, endDate }]; rows are
// bucketed by their session date falling inside a period's range.
export function periodView({
  evaluations,
  assignmentId,
  periods,
  seq,
  parameters,
  dimension = 'quality',
}) {
  const own = evaluations
    .filter((item) => item.assignmentId === assignmentId)
    .slice()
    .sort((a, b) => String(a.sessionDate).localeCompare(String(b.sessionDate)));
  const bucketOf = (sessionDate) => {
    const d = String(sessionDate ?? '').slice(0, 10);
    return (
      periods.find(
        (period) => period.startDate <= d && d <= period.endDate
      )?.seq ?? null
    );
  };

  // member cell shadows group cell per (session, parameter) and across the
  // period; within the same precedence tier, a later non-null value updates an
  // earlier value, while a later null does not erase an earlier non-null score.
  const cellValue = new Map(); // `${seq}:${parameterId}` → {value, viaGroup}
  const memberKeys = new Set(
    own.filter((item) => item.membershipId !== null).map((item) => `${item.sessionId}:${item.parameterId}`)
  );
  for (const item of own) {
    const seq = bucketOf(item.sessionDate);
    if (seq === null) continue;
    const key = `${seq}:${item.parameterId}`;
    const viaGroup = item.membershipId === null;
    if (viaGroup && memberKeys.has(`${item.sessionId}:${item.parameterId}`)) continue;
    const value =
      dimension === 'quantity' ? item.quantityValue : item.qualityValue;
    const existing = cellValue.get(key);
    if (!existing) {
      cellValue.set(key, { value, viaGroup });
    } else if (existing.viaGroup && !viaGroup) {
      cellValue.set(key, {
        value: value !== null ? value : existing.value,
        viaGroup: false,
      });
    } else if (existing.viaGroup === viaGroup) {
      if (value !== null) {
        cellValue.set(key, { value, viaGroup });
      }
    }
  }

  return parameters
    .filter((parameter) =>
      [...cellValue.keys()].some((key) => key.endsWith(`:${parameter.id}`))
    )
    .map((parameter) => {
      const value = cellValue.get(`${seq}:${parameter.id}`)?.value ?? null;
      const previous =
        cellValue.get(`${seq - 1}:${parameter.id}`)?.value ?? null;
      return {
        parameter,
        value,
        viaGroup: cellValue.get(`${seq}:${parameter.id}`)?.viaGroup ?? false,
        change:
          value !== null && previous !== null ? round(value - previous) : null,
        percent: percentOfRange(value, parameter.minValue, parameter.maxValue),
      };
    });
}

export function parameterView({ evaluations, parameterId, dimension = 'quality' }) {
  const memberKeys = new Set(
    evaluations
      .filter((item) => item.membershipId !== null && item.parameterId === parameterId)
      .map((item) => item.sessionId)
  );
  const bySession = new Map();
  for (const item of evaluations.filter(
    (row) => row.parameterId === parameterId
  )) {
    if (item.membershipId === null && memberKeys.has(item.sessionId)) continue;
    const value = dimension === 'quantity' ? item.quantityValue : item.qualityValue;
    const viaGroup = item.membershipId === null;
    const existing = bySession.get(item.sessionId);
    if (!existing || (existing.value === null && value !== null)) {
      bySession.set(item.sessionId, {
        sessionId: item.sessionId,
        sessionDate: item.sessionDate,
        assignmentId: item.assignmentId,
        value,
        viaGroup,
      });
    }
  }
  const points = [...bySession.values()];
  points.sort((a, b) => String(a.sessionDate).localeCompare(String(b.sessionDate)));

  const scored = points.filter((point) => point.value !== null);
  if (scored.length === 0) {
    return { points, stats: null };
  }
  const first = scored[0];
  const latest = scored[scored.length - 1];
  const sum = scored.reduce((total, point) => total + point.value, 0);

  return {
    points,
    stats: {
      count: scored.length,
      first: { sessionDate: first.sessionDate, value: first.value },
      latest: { sessionDate: latest.sessionDate, value: latest.value },
      average: round(sum / scored.length),
      change:
        scored.length > 1 ? round(latest.value - first.value) : null,
    },
  };
}
