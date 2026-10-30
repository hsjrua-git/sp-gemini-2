import { describe, it, expect } from 'vitest';
import { toCell, toSheetData } from './xlsx.js';

describe('toCell', () => {
  it('keeps numbers and booleans as typed values', () => {
    expect(toCell(42)).toEqual({ value: 42, type: Number });
    expect(toCell(0)).toEqual({ value: 0, type: Number });
    expect(toCell(true)).toEqual({ value: true, type: Boolean });
  });

  it('treats blanks and non-finite numbers as an empty cell', () => {
    expect(toCell(null)).toBe(null);
    expect(toCell(undefined)).toBe(null);
    expect(toCell('')).toBe(null);
    expect(toCell(Infinity)).toBe(null);
    expect(toCell(NaN)).toBe(null);
  });

  it('formula-guards text cells and bolds the header', () => {
    expect(toCell('Ana')).toEqual({ value: 'Ana', type: String });
    expect(toCell('=1+1')).toEqual({ value: "'=1+1", type: String });
    expect(toCell('Full name', true)).toEqual({ value: 'Full name', type: String, fontWeight: 'bold' });
    // A dangerous string in the header is still guarded and still bold.
    expect(toCell('@cmd', true)).toEqual({ value: "'@cmd", type: String, fontWeight: 'bold' });
  });
});

describe('toSheetData', () => {
  it('bolds only the first row and maps every cell', () => {
    const grid = toSheetData([
      ['Name', 'Score'],
      ['Ben', 3],
      ['Ana', null],
    ]);
    expect(grid[0]).toEqual([
      { value: 'Name', type: String, fontWeight: 'bold' },
      { value: 'Score', type: String, fontWeight: 'bold' },
    ]);
    expect(grid[1]).toEqual([{ value: 'Ben', type: String }, { value: 3, type: Number }]);
    expect(grid[2]).toEqual([{ value: 'Ana', type: String }, null]);
  });
});
