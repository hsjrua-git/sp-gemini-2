import { isUuid } from './ids.js';

export const MAX_VIEWS_PER_USER = 50;
export const OPERATORS = ['lt', 'lte', 'gt', 'gte', 'eq', 'missing', 'present'];
export const DIMENSIONS = ['quality', 'quantity'];

const VALUE_OPERATORS = new Set(['lt', 'lte', 'gt', 'gte', 'eq']);
const MAX_FILTERS = 10;
const MAX_COLUMNS = 100;
const MAX_SEARCH = 100;
const MAX_ABS_VALUE = 1_000_000_000;

export function parseViewName(input) {
  if (typeof input !== 'string') {
    return { error: 'A name is required.', code: 'VALIDATION_REQUIRED' };
  }
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < 1 || value.length > 60) {
    return {
      error: 'The name must be 1 to 60 characters.',
      code: 'VALIDATION_INVALID_LENGTH',
      params: { min: 1, max: 60 },
    };
  }
  return { value };
}

function parseFilter(input) {
  if (input === null || typeof input !== 'object') {
    return {
      error: 'Each filter must be an object.',
      code: 'VALIDATION_INVALID_TYPE',
    };
  }
  if (!isUuid(input.parameterId)) {
    return {
      error: 'Each filter needs a valid parameterId.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'parameterId' },
    };
  }
  if (!OPERATORS.includes(input.op)) {
    return {
      error: `A filter condition must be one of: ${OPERATORS.join(', ')}.`,
      code: 'VALIDATION_INVALID_CHOICE',
    };
  }
  if (!VALUE_OPERATORS.has(input.op)) {
    return { value: { parameterId: input.parameterId, op: input.op } };
  }

  const { value } = input;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    Math.abs(value) > MAX_ABS_VALUE
  ) {
    return {
      error: 'This filter needs a whole number as its value.',
      code: 'VALIDATION_INVALID_TYPE',
    };
  }
  return { value: { parameterId: input.parameterId, op: input.op, value } };
}

// A saved view pins one assignment's grid: which period (null = the
// assignment's latest), which dimension feeds the value columns and filters,
// the visible columns, their filters, the sort and the search text.
export function parseViewConfig(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      error: 'The view settings are missing.',
      code: 'VALIDATION_REQUIRED',
    };
  }

  if (!isUuid(input.assignmentId)) {
    return {
      error: 'A view needs a valid assignmentId.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'assignmentId' },
    };
  }

  let seq = null;
  if (input.seq !== undefined && input.seq !== null) {
    if (!Number.isInteger(input.seq) || input.seq < 1) {
      return {
        error: 'seq must be a whole number from 1 (or null for the latest).',
        code: 'VALIDATION_INVALID_RANGE',
        params: { min: 1 },
      };
    }
    seq = input.seq;
  }

  const dimension = input.dimension ?? 'quality';
  if (!DIMENSIONS.includes(dimension)) {
    return {
      error: `dimension must be one of: ${DIMENSIONS.join(', ')}.`,
      code: 'VALIDATION_INVALID_CHOICE',
    };
  }

  const parameterIds = input.parameterIds ?? [];
  if (
    !Array.isArray(parameterIds) ||
    parameterIds.length > MAX_COLUMNS ||
    !parameterIds.every(isUuid) ||
    new Set(parameterIds).size !== parameterIds.length
  ) {
    return {
      error: 'parameterIds must be a list of unique valid IDs.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'parameterIds' },
    };
  }

  const rawFilters = input.filters ?? [];
  if (!Array.isArray(rawFilters) || rawFilters.length > MAX_FILTERS) {
    return {
      error: `Use at most ${MAX_FILTERS} filters.`,
      code: 'VALIDATION_TOO_LONG',
      params: { max: MAX_FILTERS },
    };
  }
  const filters = [];
  for (const raw of rawFilters) {
    const parsed = parseFilter(raw);
    if (parsed.error) {
      return { error: parsed.error, code: parsed.code, params: parsed.params };
    }
    filters.push(parsed.value);
  }

  const sort = input.sort ?? { key: 'name', direction: 'asc' };
  const isObject = sort !== null && typeof sort === 'object';
  const keyOk =
    isObject && (sort.key === 'name' || sort.key === 'code' || isUuid(sort.key));
  const directionOk =
    isObject && (sort.direction === 'asc' || sort.direction === 'desc');
  if (!keyOk || !directionOk) {
    return {
      error:
        'sort needs a key (name, code or a parameter ID) and a direction (asc or desc).',
      code: 'VALIDATION_INVALID_CHOICE',
    };
  }

  const search = input.search ?? '';
  if (typeof search !== 'string' || search.trim().length > MAX_SEARCH) {
    return {
      error: `The search text can be at most ${MAX_SEARCH} characters.`,
      code: 'VALIDATION_TOO_LONG',
      params: { max: MAX_SEARCH },
    };
  }

  const showChange = input.showChange ?? false;
  if (typeof showChange !== 'boolean') {
    return {
      error: 'showChange must be true or false.',
      code: 'VALIDATION_INVALID_TYPE',
    };
  }

  return {
    value: {
      assignmentId: input.assignmentId,
      seq,
      dimension,
      parameterIds,
      filters,
      sort: { key: sort.key, direction: sort.direction },
      search: search.trim(),
      showChange,
    },
  };
}
