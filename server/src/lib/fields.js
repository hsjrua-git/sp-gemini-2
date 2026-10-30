// Custom student fields. Definitions are admin-defined; values live in the
// students.extra JSONB column keyed by field definition id.

export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'yes_no',
  'choice',
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Validate & normalise ONE value against its definition.
// Returns { value } (normalised) or { error }. A value of null/'' clears.
export function validateFieldValue(definition, raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { value: null };
  }
  switch (definition.fieldType) {
    case 'text': {
      if (typeof raw !== 'string') {
        return {
          error: `${definition.label} must be text.`,
          code: 'VALIDATION_INVALID_TYPE',
          params: { label: definition.label },
        };
      }
      const value = raw.trim();
      if (value.length > 200) {
        return {
          error: `${definition.label} is too long (max 200).`,
          code: 'VALIDATION_TOO_LONG',
          params: { max: 200, label: definition.label },
        };
      }
      return { value: value === '' ? null : value };
    }
    case 'long_text': {
      if (typeof raw !== 'string') {
        return {
          error: `${definition.label} must be text.`,
          code: 'VALIDATION_INVALID_TYPE',
          params: { label: definition.label },
        };
      }
      const value = raw.trim();
      if (value.length > 2000) {
        return {
          error: `${definition.label} is too long (max 2000).`,
          code: 'VALIDATION_TOO_LONG',
          params: { max: 2000, label: definition.label },
        };
      }
      return { value: value === '' ? null : value };
    }
    case 'number': {
      const number = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(number)) {
        return {
          error: `${definition.label} must be a number.`,
          code: 'VALIDATION_INVALID_TYPE',
          params: { label: definition.label },
        };
      }
      return { value: number };
    }
    case 'date': {
      if (typeof raw !== 'string' || !isRealDate(raw)) {
        return {
          error: `${definition.label} must be a date (YYYY-MM-DD).`,
          code: 'VALIDATION_INVALID_DATE',
          params: { label: definition.label },
        };
      }
      return { value: raw };
    }
    case 'yes_no': {
      if (typeof raw !== 'boolean') {
        return {
          error: `${definition.label} must be yes or no.`,
          code: 'VALIDATION_INVALID_TYPE',
          params: { label: definition.label },
        };
      }
      return { value: raw };
    }
    case 'choice': {
      if (typeof raw !== 'string' || !definition.choices.includes(raw)) {
        return {
          error: `${definition.label} must be one of the allowed choices.`,
          code: 'VALIDATION_INVALID_CHOICE',
          params: { label: definition.label },
        };
      }
      return { value: raw };
    }
    default:
      return {
        error: `Unknown field type for ${definition.label}.`,
        code: 'FIELDS_UNKNOWN_TYPE',
        params: { label: definition.label },
      };
  }
}

// Validate an incoming extra object against the live definitions. Unknown keys
// are rejected. Returns { value } (only the keys that were supplied, cleaned)
// or { error }.
export function validateExtra(definitions, incoming) {
  if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return {
      error: 'Custom fields must be an object.',
      code: 'VALIDATION_INVALID_TYPE',
    };
  }
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const clean = {};
  for (const [id, raw] of Object.entries(incoming)) {
    const definition = byId.get(id);
    if (!definition) {
      return {
        error: 'That custom field no longer exists.',
        code: 'NOT_FOUND',
        params: { entity: 'field' },
      };
    }
    const checked = validateFieldValue(definition, raw);
    if (checked.error) return checked;
    if (checked.value !== null) clean[id] = checked.value;
  }
  return { value: clean };
}

// Strip restricted field values from an extra object for users who may not see
// them. `definitions` must include restriction flags for archived fields too.
export function stripRestricted(definitions, extra, canSeeRestricted) {
  if (canSeeRestricted) return extra ?? {};
  const restricted = new Set(
    definitions.filter((definition) => definition.isRestricted).map((d) => d.id)
  );
  const result = {};
  for (const [id, value] of Object.entries(extra ?? {})) {
    if (!restricted.has(id)) result[id] = value;
  }
  return result;
}
