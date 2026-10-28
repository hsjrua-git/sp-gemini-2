// Operator labels are NOT here: the select options and the filter chips
// translate the stable `value` ids through the reports namespace's
// filterEditor.operators.* keys at render time (lib stays data-only).
//
// The view filters/sorts the assignment-period grid the server assembled:
// rows are the assignment's targets (the whole-group row + members), each
// cell carries BOTH dimensions plus its answered state, and the view picks
// ONE dimension (quality | quantity) to feed the value columns, the filters
// and the stats.
import i18n from '../i18n/index.js';

export const OPERATORS = [
  { value: 'lt', symbol: '<', needsValue: true },
  { value: 'lte', symbol: '≤', needsValue: true },
  { value: 'gt', symbol: '>', needsValue: true },
  { value: 'gte', symbol: '≥', needsValue: true },
  { value: 'eq', symbol: '=', needsValue: true },
  { value: 'missing', symbol: null, needsValue: false },
  { value: 'present', symbol: null, needsValue: false },
];

export const DIMENSIONS = ['quality', 'quantity'];
export const MAX_FILTERS = 10;

const OPERATOR_BY_VALUE = new Map(OPERATORS.map((item) => [item.value, item]));

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

let nextKey = 1;
export function newFilterKey() {
  return `f${nextKey++}`;
}

export function defaultConfig() {
  return {
    assignmentId: null,
    seq: null, // null = the assignment's latest period
    dimension: 'quality',
    parameterIds: [],
    filters: [],
    sort: { key: 'name', direction: 'asc' },
    search: '',
    showChange: false,
  };
}

function cleanFilter(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const operator = OPERATOR_BY_VALUE.get(raw.op);
  if (typeof raw.parameterId !== 'string' || !operator) return null;
  if (!operator.needsValue) return { parameterId: raw.parameterId, op: raw.op };
  if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return null;
  return { parameterId: raw.parameterId, op: raw.op, value: raw.value };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function normalizeConfig(raw) {
  const base = defaultConfig();
  if (raw === null || typeof raw !== 'object') return base;

  const sort = raw.sort;
  const sortOk =
    sort !== null &&
    typeof sort === 'object' &&
    typeof sort.key === 'string' &&
    (sort.direction === 'asc' || sort.direction === 'desc');
  const seqOk = raw.seq === null || raw.seq === undefined;

  return {
    assignmentId: isUuid(raw.assignmentId) ? raw.assignmentId : null,
    seq: seqOk ? null : Number.isInteger(raw.seq) && raw.seq >= 1 ? raw.seq : null,
    dimension: DIMENSIONS.includes(raw.dimension) ? raw.dimension : base.dimension,
    parameterIds: Array.isArray(raw.parameterIds)
      ? raw.parameterIds.filter((id) => typeof id === 'string')
      : [],
    filters: Array.isArray(raw.filters)
      ? raw.filters.map(cleanFilter).filter(Boolean)
      : [],
    sort: sortOk ? { key: sort.key, direction: sort.direction } : base.sort,
    search: typeof raw.search === 'string' ? raw.search.trim() : '',
    showChange: raw.showChange === true,
  };
}

export function withFilterKeys(config) {
  return {
    ...config,
    filters: config.filters.map((filter) => ({ ...filter, key: newFilterKey() })),
  };
}

export function sameConfig(a, b) {
  return JSON.stringify(normalizeConfig(a)) === JSON.stringify(normalizeConfig(b));
}

export function toggleSort(sort, key) {
  if (sort.key === key) {
    return { key, direction: sort.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: 'asc' };
}

export function toggleColumn(selectedIds, allIds, parameterId, shouldShow) {
  const current =
    selectedIds.length === 0
      ? allIds
      : selectedIds.filter((id) => allIds.includes(id));
  const next = shouldShow
    ? [...new Set([...current, parameterId])]
    : current.filter((id) => id !== parameterId);

  if (!shouldShow && next.length === 0) return selectedIds;
  return next.length === allIds.length ? [] : next;
}

// The row's saved value for one parameter, in the viewed dimension. A cell
// the evaluator never selected is undefined; a selected-but-unanswered cell
// is null.
export function valueOf(row, parameterId, dimension) {
  const cell = row.cells[parameterId];
  if (cell === undefined) return undefined;
  return cell[dimension] ?? null;
}

export function changeOf(row, parameterId, dimension) {
  const now = valueOf(row, parameterId, dimension);
  const before = row.previous[parameterId]?.[dimension];
  if (now === undefined || now === null || before === undefined || before === null) {
    return null;
  }
  return round(now - before);
}

export function describeFilter(filter, parametersById) {
  const name =
    parametersById.get(filter.parameterId)?.name ??
    i18n.t('reports:filter.unknownParameter');
  const operator = OPERATOR_BY_VALUE.get(filter.op);
  if (!operator) return name;
  if (operator.needsValue) return `${name} ${operator.symbol} ${filter.value}`;
  return `${name} ${i18n.t(`reports:filterEditor.operators.${filter.op}`)}`;
}

function matchesFilter(row, filter, dimension) {
  const value = valueOf(row, filter.parameterId, dimension);
  const has = value !== undefined && value !== null;
  if (filter.op === 'missing') return !has;
  if (filter.op === 'present') return has;
  return has && COMPARE[filter.op](value, filter.value);
}

function normalizeCode(text) {
  return text.replace(/[-\s]/g, '').toLowerCase();
}

export function applyView({ rows, parameters, config }) {
  const known = new Set(parameters.map((parameter) => parameter.id));
  const dimension = DIMENSIONS.includes(config.dimension)
    ? config.dimension
    : 'quality';
  const cleaned = config.filters.map(cleanFilter).filter(Boolean);
  const activeFilters = cleaned.filter((filter) => known.has(filter.parameterId));
  const ignoredFilters = config.filters.length - activeFilters.length;

  const needle = config.search.trim().toLowerCase();
  const codeNeedle = normalizeCode(needle);

  const matching = rows.filter((row) => {
    if (needle) {
      const nameMatch = row.fullName.toLowerCase().includes(needle);
      const codeMatch =
        codeNeedle !== '' &&
        row.studentCode !== null &&
        row.studentCode.toLowerCase().includes(codeNeedle);
      if (!nameMatch && !codeMatch) return false;
    }
    return activeFilters.every((filter) => matchesFilter(row, filter, dimension));
  });

  const direction = config.sort.direction === 'desc' ? -1 : 1;
  const key = config.sort.key;
  const byName = (a, b) =>
    a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' }) ||
    (a.membershipId ?? 'group').localeCompare(b.membershipId ?? 'group');

  let compare;
  if (key === 'name') {
    compare = (a, b) => byName(a, b) * direction;
  } else if (key === 'code') {
    compare = (a, b) =>
      String(a.studentCode ?? '').localeCompare(String(b.studentCode ?? '')) *
        direction || byName(a, b);
  } else if (known.has(key)) {
    compare = (a, b) => {
      const aHas = valueOf(a, key, dimension) !== undefined;
      const bHas = valueOf(b, key, dimension) !== undefined;
      if (!aHas && !bHas) return byName(a, b);
      if (!aHas) return 1;
      if (!bHas) return -1;
      return (valueOf(a, key, dimension) ?? 0) * direction - (valueOf(b, key, dimension) ?? 0) * direction || byName(a, b);
    };
  } else {
    compare = byName;
  }
  const sorted = [...matching].sort(compare);
  const studentRows = sorted.filter((row) => !row.isGroup);

  const stats = {};
  for (const parameter of parameters) {
    const measured = studentRows
      .map((row) => valueOf(row, parameter.id, dimension))
      .filter((value) => value !== undefined && value !== null);
    stats[parameter.id] =
      measured.length === 0
        ? { count: 0, average: null, min: null, max: null }
        : {
            count: measured.length,
            average: round(measured.reduce((sum, value) => sum + value, 0) / measured.length),
            min: Math.min(...measured),
            max: Math.max(...measured),
          };
  }

  return { rows: sorted, stats, ignoredFilters, dimension };
}
