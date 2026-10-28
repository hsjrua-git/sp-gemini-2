import { describe, it, expect } from 'vitest';
import { csvField, toCsv } from './csv.js';

const BOM = String.fromCharCode(0xfeff);

describe('csvField', () => {
  it('renders blanks and non-finite numbers as empty', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(Number.NaN)).toBe('');
    expect(csvField(Infinity)).toBe('');
  });

  it('passes plain values through untouched', () => {
    expect(csvField('Ada')).toBe('Ada');
    expect(csvField(7.5)).toBe('7.5');
  });

  it('quotes fields containing the delimiter, quotes or newlines', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('she said "hi"')).toBe('"she said ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises formula-injection prefixes on text', () => {
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('@cmd')).toBe("'@cmd");
  });

  it('does not treat a negative number as a formula', () => {
    expect(csvField(-3)).toBe('-3');
  });

  it('honours a custom delimiter', () => {
    expect(csvField('a;b', ';')).toBe('"a;b"');
    expect(csvField('a,b', ';')).toBe('a,b');
  });
});

describe('toCsv', () => {
  it('prepends a BOM and joins rows with CRLF, trailing newline', () => {
    const out = toCsv([
      ['Name', 'Score'],
      ['Ada', 9],
    ]);
    // The leading BOM helps spreadsheet apps detect UTF-8.
    expect(out).toBe(`${BOM}Name,Score\r\nAda,9\r\n`);
  });
});
