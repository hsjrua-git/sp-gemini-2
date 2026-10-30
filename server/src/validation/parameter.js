import { isUuid } from '../lib/ids.js';

const MAX_NAME = 60;
const MAX_CODE = 40;

export function parseParameterInput(body, { partial = false } = {}) {
  const input =
    body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const values = {};

  if ('parentId' in input) {
    if (input.parentId !== null && !isUuid(input.parentId)) {
      return { error: 'Choose a valid parent parameter.', code: 'VALIDATION_INVALID_CHOICE' };
    }
    values.parentId = input.parentId;
  }

  if (!partial || 'name' in input) {
    const name =
      typeof input.name === 'string'
        ? input.name.trim().replace(/\s+/g, ' ')
        : '';
    if (name.length < 1 || name.length > MAX_NAME) {
      return {
        error: `Name must be between 1 and ${MAX_NAME} characters.`,
        code: 'VALIDATION_INVALID_LENGTH',
        params: { min: 1, max: MAX_NAME },
      };
    }
    values.name = name;
  }

  if (!partial || 'code' in input) {
    const code =
      typeof input.code === 'string' ? input.code.trim().replace(/\s+/g, '-') : '';
    if (code.length < 1 || code.length > MAX_CODE) {
      return {
        error: `Code must be between 1 and ${MAX_CODE} characters.`,
        code: 'VALIDATION_INVALID_LENGTH',
        params: { min: 1, max: MAX_CODE },
      };
    }
    values.code = code;
  }

  for (const key of ['minValue', 'maxValue']) {
    if (key in input) {
      if (input[key] === null) {
        values[key] = null;
      } else if (Number.isInteger(input[key])) {
        values[key] = input[key];
      } else {
        return {
          error: `${key} must be a whole number or null.`,
          code: 'VALIDATION_INVALID_TYPE',
          params: { field: key },
        };
      }
    }
  }
  if (
    values.minValue != null &&
    values.maxValue != null &&
    values.minValue > values.maxValue
  ) {
    return {
      error: 'The minimum cannot be larger than the maximum.',
      code: 'PARAMETERS_MIN_ABOVE_MAX',
    };
  }

  if ('sortOrder' in input) {
    if (!Number.isInteger(input.sortOrder)) {
      return {
        error: 'sortOrder must be a whole number.',
        code: 'VALIDATION_INVALID_TYPE',
        params: { field: 'sortOrder' },
      };
    }
    values.sortOrder = input.sortOrder;
  }

  return { values };
}
