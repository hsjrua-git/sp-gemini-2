import { describe, it, expect } from 'vitest';
import {
  buildSaveEntries,
  cellAccess,
  cellKey,
  lockedDraftKeys,
  parseDimension,
  pruneDraft,
  resolveCellState,
  savedText,
  splitCellKey,
} from './cells.js';

const scored = { minValue: 0, maxValue: 10 };
const open = { minValue: null, maxValue: null };

describe('cellKey / splitCellKey / savedText', () => {
  it('joins the membership and parameter with a colon; null means the group', () => {
    expect(cellKey('m1', 'p1')).toBe('m1:p1');
    expect(cellKey(null, 'p1')).toBe('group:p1');
    expect(splitCellKey('m1:p1')).toEqual({ membershipId: 'm1', parameterId: 'p1' });
    expect(splitCellKey('group:p1')).toEqual({
      membershipId: null,
      parameterId: 'p1',
    });
  });

  it('renders null/undefined as an empty string, numbers as text', () => {
    expect(savedText(null)).toBe('');
    expect(savedText(undefined)).toBe('');
    expect(savedText(0)).toBe('0');
    expect(savedText(7)).toBe('7');
  });
});

describe('parseDimension', () => {
  it('treats blank as a cleared value', () => {
    expect(parseDimension('   ', open)).toEqual({ value: null });
  });

  it('accepts only whole numbers', () => {
    expect(parseDimension('7', open)).toEqual({ value: 7 });
    expect(parseDimension('+3', open)).toEqual({ value: 3 });
    expect(parseDimension('7.5', open).error).toBeTruthy();
    expect(parseDimension('7,5', open).error).toBeTruthy();
    expect(parseDimension('abc', open).error).toBeTruthy();
  });

  it('enforces the parameter min and max', () => {
    expect(parseDimension('-1', scored).error).toMatch(/at least/i);
    expect(parseDimension('11', scored).error).toMatch(/at most/i);
    expect(parseDimension('10', scored)).toEqual({ value: 10 });
  });
});

describe('resolveCellState', () => {
  it('keeps saved values for dimensions the draft does not mention', () => {
    const saved = { qualityValue: 4, quantityValue: 6 };
    const state = resolveCellState({
      draft: { qualityText: '5' },
      saved,
      parameter: scored,
    });
    expect(state.qualityValue).toBe(5);
    expect(state.quantityValue).toBe(6);
  });

  it('a comment edit re-sends the untouched saved values (the payload is the whole cell)', () => {
    const saved = { qualityValue: 4, quantityValue: 6 };
    const state = resolveCellState({
      draft: { qualityComment: 'good week' },
      saved,
      parameter: scored,
    });
    expect(state.qualityValue).toBe(4);
    expect(state.quantityValue).toBe(6);
    expect(state.qualityComment).toBe('good week');
  });

  it('a blank comment resolves to null (clear it)', () => {
    const state = resolveCellState({
      draft: { qualityComment: '   ' },
      saved: null,
      parameter: scored,
    });
    expect(state.qualityComment).toBe(null);
  });

  it('reports parse errors per dimension', () => {
    const state = resolveCellState({
      draft: { qualityText: 'x', quantityText: '99' },
      saved: null,
      parameter: scored,
    });
    expect(state.errors.quality).toMatch(/whole number/i);
    expect(state.errors.quantity).toMatch(/at most/i);
  });
});

describe('pruneDraft', () => {
  it('drops a draft that resolves to exactly the saved state', () => {
    const saved = { qualityValue: 4, quantityValue: null };
    expect(pruneDraft({ qualityText: '4' }, saved, scored)).toBe(null);
  });

  it('keeps a fresh selection: it creates the expectation row', () => {
    expect(pruneDraft({ selected: true }, null, scored)).toEqual({ selected: true });
  });

  it('keeps an unselect of a saved row and drops one of a missing row', () => {
    expect(pruneDraft({ selected: false }, { qualityValue: 4 }, scored)).toEqual({
      selected: false,
    });
    expect(pruneDraft({ selected: false }, null, scored)).toBe(null);
  });

  it('keeps drafts with parse errors (they must stay visible)', () => {
    expect(pruneDraft({ qualityText: 'x' }, null, scored)).toEqual({
      qualityText: 'x',
    });
  });
});

describe('buildSaveEntries', () => {
  const params = new Map([['p1', scored]]);

  it('sends the full cell state for a value edit', () => {
    const { entries } = buildSaveEntries({
      drafts: { 'm1:p1': { qualityText: '8' } },
      savedByCell: new Map(),
      parametersById: params,
    });
    expect(entries).toEqual([
      {
        membershipId: 'm1',
        parameterId: 'p1',
        selected: true,
        qualityValue: 8,
        quantityValue: null,
        qualityComment: null,
        quantityComment: null,
      },
    ]);
  });

  it('unselecting a saved row sends selected:false (the row is the expectation)', () => {
    const { entries } = buildSaveEntries({
      drafts: { 'group:p1': { selected: false } },
      savedByCell: new Map([['group:p1', { qualityValue: 3 }]]),
      parametersById: params,
    });
    expect(entries).toEqual([
      {
        membershipId: null,
        parameterId: 'p1',
        selected: false,
        qualityValue: null,
        quantityValue: null,
        qualityComment: null,
        quantityComment: null,
      },
    ]);
  });

  it('skips drafts whose parameter is unknown', () => {
    const { entries, errors } = buildSaveEntries({
      drafts: { 'm1:ghost': { qualityText: '5' } },
      savedByCell: new Map(),
      parametersById: params,
    });
    expect(entries).toEqual([]);
    expect(errors).toEqual({});
  });

  it('holds back cells with parse errors (all-or-nothing save)', () => {
    const { entries, errors } = buildSaveEntries({
      drafts: {
        'm1:p1': { qualityText: '8' },
        'm2:p1': { quantityText: 'oops' },
      },
      savedByCell: new Map(),
      parametersById: params,
    });
    expect(entries).toHaveLength(1);
    expect(errors['m2:p1'].quantity).toBeTruthy();
  });
});

describe('cellAccess', () => {
  it('is open with no lock or an unlocked lock', () => {
    expect(cellAccess(null, false)).toBe('open');
    expect(cellAccess({ isLocked: false }, false)).toBe('open');
  });

  it('is override for locked cells only when the user can override', () => {
    expect(cellAccess({ isLocked: true }, true)).toBe('override');
    expect(cellAccess({ isLocked: true }, false)).toBe('locked');
  });
});

describe('lockedDraftKeys', () => {
  it('returns edited keys that point at a locked saved row', () => {
    const savedByCell = new Map([
      ['a:p', { isLocked: true }],
      ['b:p', { isLocked: false }],
    ]);
    const keys = lockedDraftKeys(
      { 'a:p': { qualityText: '5' }, 'b:p': { qualityText: '5' } },
      savedByCell
    );
    expect(keys).toEqual(['a:p']);
  });
});
