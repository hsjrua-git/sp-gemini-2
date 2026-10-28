// Helpers for turning custom-field definitions and a student's stored `extra`
// object into editable form values, and back again. Kept separate from the
// StudentFieldInputs component so that file only exports a component (which
// keeps React Fast Refresh working during development).
//
// Value contract while editing: numbers and dates are kept as strings; yes/no
// is kept as a real boolean; everything else is a trimmed string.

// Turn a student's stored `extra` into an editable values map (blank = unset).
export function extraToValues(definitions, extra) {
  const values = {};
  for (const definition of definitions) {
    const stored = extra?.[definition.id];
    values[definition.id] =
      stored === undefined || stored === null ? '' : stored;
  }
  return values;
}

// Build an `extra` object for CREATE: only non-empty, correctly typed values.
export function cleanExtra(definitions, values) {
  const extra = {};
  for (const definition of definitions) {
    const raw = values[definition.id];
    if (raw === undefined || raw === null || raw === '') continue;
    if (definition.fieldType === 'number') {
      const number = Number(raw);
      if (Number.isFinite(number)) extra[definition.id] = number;
    } else if (definition.fieldType === 'yes_no') {
      if (typeof raw === 'boolean') extra[definition.id] = raw;
    } else {
      const text = String(raw).trim();
      if (text !== '') extra[definition.id] = text;
    }
  }
  return extra;
}

// Build an `extra` object for PATCH: every visible field is included, with
// blanks sent as '' so the server clears them (unlisted keys stay untouched).
export function buildExtraPatch(definitions, values) {
  const extra = {};
  for (const definition of definitions) {
    const raw = values[definition.id];
    if (raw === undefined || raw === null || raw === '') {
      extra[definition.id] = '';
    } else if (definition.fieldType === 'number') {
      extra[definition.id] = Number(raw);
    } else if (definition.fieldType === 'yes_no') {
      extra[definition.id] = raw;
    } else {
      extra[definition.id] = String(raw).trim();
    }
  }
  return extra;
}
