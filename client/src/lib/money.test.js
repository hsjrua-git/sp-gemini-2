import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatWhole,
  parseQuantity,
  parseWholeNumber,
} from './money.js';

describe('formatWhole / formatAmount', () => {
  it('formats whole Toman with separators and no decimals', () => {
    expect(formatWhole(250000)).toBe('250,000');
    expect(formatWhole(-5000)).toBe('-5,000');
    expect(formatWhole(undefined)).toBe('0');
  });

  it('formats line totals with up to three decimals', () => {
    expect(formatAmount(0.5 * 25000)).toBe('12,500');
    expect(formatAmount(1.234 * 1000)).toBe('1,234');
  });
});

describe('parseWholeNumber', () => {
  it('accepts Persian digits and stray separators', () => {
    expect(parseWholeNumber('۲۵۰٬۰۰۰')).toBe(250000);
    expect(parseWholeNumber('250,000')).toBe(250000);
    expect(parseWholeNumber(' 42 ')).toBe(42);
  });

  it('rejects fractions and junk', () => {
    expect(parseWholeNumber('2.5')).toBeNull();
    expect(parseWholeNumber('abc')).toBeNull();
    expect(parseWholeNumber('')).toBeNull();
    expect(parseWholeNumber('-500')).toBeNull();
    expect(parseWholeNumber('-500', { signed: true })).toBe(-500);
  });
});

describe('parseQuantity', () => {
  it('accepts both decimal separators and Persian digits', () => {
    expect(parseQuantity('۱٫۵')).toBe(1.5);
    expect(parseQuantity('0.5')).toBe(0.5);
    expect(parseQuantity('100000')).toBe(100000);
  });

  it('enforces positivity and the range cap', () => {
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('-3')).toBeNull();
    expect(parseQuantity('100001')).toBeNull();
  });

  it('allows signed values only when asked (stock corrections)', () => {
    expect(parseQuantity('-2.5')).toBeNull();
    expect(parseQuantity('-2.5', { signed: true })).toBe(-2.5);
    expect(parseQuantity('0', { signed: true })).toBeNull();
  });
});
