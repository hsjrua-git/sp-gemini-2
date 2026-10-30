import { describe, it, expect } from 'vitest';
import {
  buildNames,
  guessColumns,
  looksLikeHeader,
  prepareRows,
} from './importNames.js';

describe('prepareRows', () => {
  it('numbers rows from 1 and drops fully blank ones', () => {
    const rows = prepareRows([['Ada'], ['', '  '], ['Bea']]);
    expect(rows).toEqual([
      { row: 1, cells: ['Ada'] },
      { row: 3, cells: ['Bea'] },
    ]);
  });
});

describe('looksLikeHeader', () => {
  it('detects common name-column headers', () => {
    expect(looksLikeHeader(['Full Name'])).toBe(true);
    expect(looksLikeHeader(['first_name', 'surname'])).toBe(true);
    expect(looksLikeHeader(['Ada Lovelace'])).toBe(false);
  });
});

describe('guessColumns', () => {
  it('prefers a single full-name column when present', () => {
    expect(guessColumns(['id', 'Name'])).toEqual({
      mode: 'single',
      firstColumn: 1,
      secondColumn: null,
    });
  });

  it('uses first + last name columns when there is no full-name column', () => {
    expect(guessColumns(['First Name', 'Last Name'])).toEqual({
      mode: 'two',
      firstColumn: 0,
      secondColumn: 1,
    });
  });

  it('falls back to the first column when nothing matches', () => {
    expect(guessColumns(['a', 'b'])).toEqual({
      mode: 'single',
      firstColumn: 0,
      secondColumn: null,
    });
  });
});

describe('buildNames', () => {
  const rows = [
    { row: 1, cells: ['First', 'Last'] },
    { row: 2, cells: ['Ada', 'Lovelace'] },
    { row: 3, cells: ['Bea', ''] },
  ];

  it('joins first + last in two-column mode, trimming stray spaces', () => {
    const names = buildNames({
      rows,
      hasHeader: true,
      mode: 'two',
      firstColumn: 0,
      secondColumn: 1,
    });
    expect(names).toEqual([
      { row: 2, fullName: 'Ada Lovelace' },
      { row: 3, fullName: 'Bea' },
    ]);
  });

  it('reads a single column when in single mode', () => {
    const names = buildNames({
      rows,
      hasHeader: true,
      mode: 'single',
      firstColumn: 0,
      secondColumn: null,
    });
    expect(names).toEqual([
      { row: 2, fullName: 'Ada' },
      { row: 3, fullName: 'Bea' },
    ]);
  });
});
