export const NORMAL_LOCK_DAYS = 7;
export const LATE_LOCK_DAYS = 1;
export const MIN_REASON = 5;
export const MAX_REASON = 300;

// The lock window anchors to the SESSION's effective date now (it anchored to
// the write moment in the period model): a session happening this week — or
// still in the future — gets the full 7-day window from its date; an older
// session's rows lock after 1 day. `sessionDate`/`today` are ISO dates.
export function lockDaysFor({ sessionDate, today }) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const day = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / MS_PER_DAY;
  };
  return day(sessionDate) + NORMAL_LOCK_DAYS >= day(today)
    ? NORMAL_LOCK_DAYS
    : LATE_LOCK_DAYS;
}

// The timestamp a row's locks_at gets: the session's effective date plus its
// window. Returns an ISO string so pg stores it exactly.
export function locksAtFor({ sessionDate, today }) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const day = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / MS_PER_DAY;
  };
  const at = (day(sessionDate) + lockDaysFor({ sessionDate, today })) * MS_PER_DAY;
  return new Date(at).toISOString();
}

// A cell key covers the whole target now: the membership (or the literal
// `group` for the whole-group row) plus the parameter.
export function cellKey(membershipId, parameterId) {
  return `${membershipId ?? 'group'}:${parameterId}`;
}

export function findLockedChanges({ entries, existing }) {
  const locked = [];
  entries.forEach((entry, index) => {
    const row = existing.get(cellKey(entry.membershipId, entry.parameterId));
    if (!row || !row.isLocked) return;
    const changed =
      (entry.selected ?? true) !== (row.selected ?? true) ||
      entry.qualityValue !== row.qualityValue ||
      entry.quantityValue !== row.quantityValue ||
      (entry.qualityComment ?? null) !== (row.qualityComment ?? null) ||
      (entry.quantityComment ?? null) !== (row.quantityComment ?? null);
    if (!changed) return;
    locked.push({
      index,
      membershipId: entry.membershipId,
      parameterId: entry.parameterId,
      lockedAt: row.locksAt,
    });
  });
  return locked;
}

export function parseOverrideReason(input) {
  const message = `Changing locked scores needs a written reason of ${MIN_REASON} to ${MAX_REASON} characters.`;
  if (typeof input !== 'string') return { error: message };
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < MIN_REASON || value.length > MAX_REASON) {
    return { error: message };
  }
  return { value };
}
