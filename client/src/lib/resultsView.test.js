import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '../i18n/index.js';
import {
  applyView,
  changeOf,
  defaultConfig,
  describeFilter,
  normalizeConfig,
  sameConfig,
  toggleColumn,
  toggleSort,
  valueOf,
} from './resultsView.js';

// describeFilter renders the valueless operators through i18next, whose
// default language is Persian; pin English for these assertions (the fa
// renderings are covered by src/i18n tests), like format.test.js does.
beforeAll(() => {
  i18n.changeLanguage('en');
});

const ASSIGNMENT = '00000000-0000-4000-8000-000000000001';
const parameters = [
  { id: 'p1', name: 'Speed', minValue: 0, maxValue: 10 },
  { id: 'p2', name: 'Strength', minValue: 0, maxValue: 10 },
];
const parametersById = new Map(parameters.map((p) => [p.id, p]));

// Server row shape: cells keyed by parameter carrying BOTH dimensions plus
// the answered state; previous holds the earlier period's per-dimension values.
const rows = [
  {
    membershipId: null,
    studentId: null,
    fullName: 'Whole group',
    studentCode: null,
    isGroup: true,
    cells: { p1: { quality: 5, quantity: 7, answered: true } },
    previous: { p1: { quality: 3, quantity: 6 } },
  },
  {
    membershipId: 'm-b',
    studentId: 'b',
    fullName: 'Ada',
    studentCode: 'S1',
    isGroup: false,
    cells: {
      p1: { quality: 9, quantity: 1, answered: true },
      p2: { quality: 4, quantity: null, answered: true },
    },
    previous: {},
  },
  {
    membershipId: 'm-c',
    studentId: 'c',
    fullName: 'Cid',
    studentCode: 'S3',
    isGroup: false,
    cells: { p1: { quality: null, quantity: null, answered: false } },
    previous: {},
  },
];

describe('normalizeConfig', () => {
  it('falls back to defaults for junk input', () => {
    expect(normalizeConfig(null)).toEqual(defaultConfig());
    expect(normalizeConfig(42)).toEqual(defaultConfig());
  });

  it('pins assignment/seq/dimension, rejects junk ones', () => {
    expect(
      normalizeConfig({ assignmentId: ASSIGNMENT, seq: 3, dimension: 'quantity' })
    ).toMatchObject({
      assignmentId: ASSIGNMENT,
      seq: 3,
      dimension: 'quantity',
    });
    expect(normalizeConfig({ assignmentId: 'nope' }).assignmentId).toBe(null);
    expect(normalizeConfig({ seq: 0 }).seq).toBe(null);
    expect(normalizeConfig({ dimension: 'depth' }).dimension).toBe('quality');
  });

  it('drops filters that are malformed or missing a required value', () => {
    const config = normalizeConfig({
      filters: [
        { parameterId: 'p1', op: 'gte', value: 5 }, // ok
        { parameterId: 'p1', op: 'gte' }, // needs a value
        { parameterId: 'p2', op: 'missing' }, // no value needed
        { op: 'gte', value: 1 }, // no parameter
        'nonsense',
      ],
    });
    expect(config.filters).toEqual([
      { parameterId: 'p1', op: 'gte', value: 5 },
      { parameterId: 'p2', op: 'missing' },
    ]);
  });
});

describe('valueOf / changeOf', () => {
  it('undefined = never selected, null = selected but unanswered', () => {
    expect(valueOf(rows[0], 'p2', 'quality')).toBeUndefined();
    expect(valueOf(rows[2], 'p1', 'quality')).toBeNull();
    expect(valueOf(rows[1], 'p1', 'quality')).toBe(9);
  });

  it('the change needs both periods and the viewed dimension', () => {
    expect(changeOf(rows[0], 'p1', 'quality')).toBe(2);
    expect(changeOf(rows[0], 'p1', 'quantity')).toBe(1);
    expect(changeOf(rows[0], 'p2', 'quality')).toBeNull(); // no cell at all
    expect(changeOf(rows[1], 'p1', 'quality')).toBeNull(); // no previous
  });
});

describe('applyView', () => {
  it('filters on the viewed dimension; unselected cells are missing', () => {
    const view = applyView({
      rows,
      parameters,
      config: { ...defaultConfig(), filters: [{ parameterId: 'p1', op: 'gt', value: 6 }] },
    });
    // Only Ada's quality 9 clears the bar in the quality dimension.
    expect(view.rows.map((row) => row.fullName)).toEqual(['Ada']);

    const quantity = applyView({
      rows,
      parameters,
      config: {
        ...defaultConfig(),
        dimension: 'quantity',
        filters: [{ parameterId: 'p1', op: 'gt', value: 6 }],
      },
    });
    // In quantity the group row's 7 clears it instead.
    expect(quantity.rows.map((row) => row.fullName)).toEqual(['Whole group']);
  });

  it('searches names and codes, keeps the group row searchable', () => {
    const byName = applyView({
      rows,
      parameters,
      config: { ...defaultConfig(), search: 'ada' },
    });
    expect(byName.rows).toHaveLength(1);
    const none = applyView({
      rows,
      parameters,
      config: { ...defaultConfig(), search: 'zzz' },
    });
    expect(none.rows).toHaveLength(0);
  });

  it('sorts by name/code/parameter value with unanswered last', () => {
    const byName = applyView({
      rows,
      parameters,
      config: { ...defaultConfig(), sort: { key: 'name', direction: 'asc' } },
    });
    expect(byName.rows.map((row) => row.fullName)).toEqual([
      'Ada',
      'Cid',
      'Whole group',
    ]);

    const bySpeed = applyView({
      rows,
      parameters,
      config: { ...defaultConfig(), sort: { key: 'p1', direction: 'desc' } },
    });
    expect(bySpeed.rows.map((row) => row.fullName)).toEqual([
      'Ada',
      'Whole group',
      'Cid', // selected-unanswered sorts after answered ones
    ]);
  });

  it('computes per-parameter stats on the viewed dimension', () => {
    const view = applyView({ rows, parameters, config: defaultConfig() });
    // Quality: 5, 9 measured. Quantity: 7, 1.
    expect(view.stats.p1).toMatchObject({ count: 2, average: 7, min: 5, max: 9 });
    const quantity = applyView({
      rows,
      parameters,
      config: { ...defaultConfig(), dimension: 'quantity' },
    });
    expect(quantity.stats.p1).toMatchObject({ count: 2, average: 4, min: 1, max: 7 });
  });

  it('reports filters that reference unknown parameters', () => {
    const view = applyView({
      rows,
      parameters,
      config: {
        ...defaultConfig(),
        filters: [{ parameterId: 'ghost', op: 'present' }],
      },
    });
    expect(view.ignoredFilters).toBe(1);
  });
});

describe('describeFilter', () => {
  it('renders symbols for value operators and words for the valueless ones', () => {
    expect(describeFilter({ parameterId: 'p1', op: 'gte', value: 5 }, parametersById)).toBe(
      'Speed ≥ 5'
    );
    expect(
      describeFilter({ parameterId: 'p1', op: 'present' }, parametersById)
    ).toContain('Speed');
  });
});

describe('toggleSort / toggleColumn / sameConfig', () => {
  it('toggles sort direction and resets on a new key', () => {
    expect(toggleSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({
      key: 'name',
      direction: 'desc',
    });
    expect(toggleSort({ key: 'name', direction: 'asc' }, 'code')).toEqual({
      key: 'code',
      direction: 'asc',
    });
  });

  it('toggleColumn keeps at least one column and collapses to all', () => {
    // An empty selection means "all": unchecking one of two leaves the other.
    expect(toggleColumn([], ['p1', 'p2'], 'p1', false)).toEqual(['p2']);
    // Re-checking the missing one re-selects everything.
    expect(toggleColumn(['p1'], ['p1', 'p2'], 'p2', true)).toEqual([]);
    expect(toggleColumn(['p1', 'p2'], ['p1', 'p2'], 'p2', false)).toEqual(['p1']);
  });

  it('sameConfig ignores key ordering and filter keys', () => {
    expect(
      sameConfig(
        { ...defaultConfig(), search: 'x' },
        { ...defaultConfig(), search: 'x' }
      )
    ).toBe(true);
    expect(sameConfig(defaultConfig(), { ...defaultConfig(), showChange: true })).toBe(
      false
    );
  });
});
