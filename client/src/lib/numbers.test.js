import { describe, it, expect } from 'vitest';
import { numberToText, parseOptionalNumber } from './numbers.js';

describe('parseOptionalNumber', () => {
  it('treats an empty string as an intentionally blank value', () => {
    expect(parseOptionalNumber('   ')).toEqual({ value: null });
  });

  it('parses a finite number', () => {
    expect(parseOptionalNumber(' 42 ')).toEqual({ value: 42 });
  });

  it('flags non-numeric text as an error', () => {
    expect(parseOptionalNumber('abc')).toEqual({ error: true });
  });
});

describe('numberToText', () => {
  it('renders null as an empty string', () => {
    expect(numberToText(null)).toBe('');
  });

  it('stringifies a number', () => {
    expect(numberToText(0)).toBe('0');
    expect(numberToText(3.5)).toBe('3.5');
  });
});
