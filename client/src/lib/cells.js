// One evaluation cell = one session target × parameter. The target is either
// a member (its membershipId) or the whole group (membershipId null, the
// literal 'group' in keys). A cell carries TWO independently-nullable integer
// dimensions — quality and quantity — each with its own comment, plus the
// row's existence: a stored row IS the expectation ("selected"), and selected
// with no values just means "not answered yet".

export function cellKey(membershipId, parameterId) {
  return `${membershipId ?? 'group'}:${parameterId}`;
}

export function splitCellKey(key) {
  const [membershipPart, parameterId] = key.split(':');
  return {
    membershipId: membershipPart === 'group' ? null : membershipPart,
    parameterId,
  };
}

export function savedText(value) {
  return value === null || value === undefined ? '' : String(value);
}

const INTEGER_PATTERN = /^[+-]?\d+$/;

// One dimension's value: a whole number inside the parameter's own range.
// An empty input means "no value" (null), not zero.
export function parseDimension(text, parameter) {
  const trimmed = text.trim();
  if (trimmed === '') return { value: null };
  if (!INTEGER_PATTERN.test(trimmed)) return { error: 'Enter a whole number.' };
  const value = Number(trimmed);
  if (parameter.minValue !== null && value < parameter.minValue) {
    return { error: `At least ${parameter.minValue}.` };
  }
  if (parameter.maxValue !== null && value > parameter.maxValue) {
    return { error: `At most ${parameter.maxValue}.` };
  }
  return { value };
}

export function cellAccess(lock, canOverride) {
  if (!lock || !lock.isLocked) return 'open';
  return canOverride ? 'override' : 'locked';
}

// Draft keys whose saved row is locked — saving them needs an override reason.
export function lockedDraftKeys(drafts, savedByCell) {
  return Object.keys(drafts).filter(
    (key) => savedByCell.get(key)?.isLocked === true
  );
}

// Resolve a cell's full state from its draft (a partial patch) on top of the
// saved row. Any dimension the draft does not mention keeps its saved value —
// an entry always carries the whole cell, because the server overwrites
// absent comments with null. Returns parse errors per dimension.
export function resolveCellState({ draft, saved, parameter }) {
  const comment = (text) => {
    const trimmed = text.trim();
    return trimmed === '' ? null : trimmed;
  };

  const errors = {};
  let qualityValue;
  if ('qualityText' in draft) {
    const result = parseDimension(draft.qualityText, parameter);
    if (result.error) errors.quality = result.error;
    else qualityValue = result.value;
  } else {
    qualityValue = saved?.qualityValue ?? null;
  }
  let quantityValue;
  if ('quantityText' in draft) {
    const result = parseDimension(draft.quantityText, parameter);
    if (result.error) errors.quantity = result.error;
    else quantityValue = result.value;
  } else {
    quantityValue = saved?.quantityValue ?? null;
  }

  return {
    selected: draft.selected ?? true,
    qualityValue: qualityValue ?? null,
    quantityValue: quantityValue ?? null,
    qualityComment:
      'qualityComment' in draft
        ? comment(draft.qualityComment)
        : saved?.qualityComment ?? null,
    quantityComment:
      'quantityComment' in draft
        ? comment(draft.quantityComment)
        : saved?.quantityComment ?? null,
    errors,
  };
}

// A draft that resolves to exactly the saved state (or unselects a row that
// does not exist) would change nothing — prune it so the dirty count and the
// payload stay honest. Selecting a row that does not exist yet IS a change:
// it creates the expectation (selected-unanswered).
export function pruneDraft(draft, saved, parameter) {
  const state = resolveCellState({ draft, saved, parameter });
  if (Object.keys(state.errors).length > 0) return draft;
  if (!state.selected) return saved ? draft : null;
  if (!saved) return draft;
  return state.qualityValue === saved.qualityValue &&
    state.quantityValue === saved.quantityValue &&
    (state.qualityComment ?? null) === (saved.qualityComment ?? null) &&
    (state.quantityComment ?? null) === (saved.quantityComment ?? null)
    ? null
    : draft;
}

// Build the bulk-save payload from the drafts on top of the saved rows.
// Cells with parse errors are held back: nothing half-valid is sent, mirroring
// the server's all-or-nothing transaction.
export function buildSaveEntries({ drafts, savedByCell, parametersById }) {
  const entries = [];
  const errors = {};

  for (const [key, draft] of Object.entries(drafts)) {
    const { membershipId, parameterId } = splitCellKey(key);
    const parameter = parametersById.get(parameterId);
    if (!parameter) continue;
    const saved = savedByCell.get(key) ?? null;

    const state = resolveCellState({ draft, saved, parameter });
    if (state.errors.quality || state.errors.quantity) {
      errors[key] = state.errors;
      continue;
    }
    if (!state.selected && !saved) continue;

    entries.push({
      membershipId,
      parameterId,
      selected: state.selected,
      // An unselect deletes the row — the values it carried are irrelevant.
      qualityValue: state.selected ? state.qualityValue : null,
      quantityValue: state.selected ? state.quantityValue : null,
      qualityComment: state.selected ? state.qualityComment : null,
      quantityComment: state.selected ? state.quantityComment : null,
    });
  }
  return { entries, errors };
}
