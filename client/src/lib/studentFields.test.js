import { describe, it, expect } from 'vitest';
import {
  buildExtraPatch,
  cleanExtra,
  extraToValues,
} from './studentFields.js';

// A representative mix of field types the panel supports.
const definitions = [
  { id: 'gpa', label: 'GPA', fieldType: 'number' },
  { id: 'scholarship', label: 'Scholarship', fieldType: 'yes_no' },
  { id: 'notes', label: 'Notes', fieldType: 'long_text' },
  { id: 'house', label: 'House', fieldType: 'choice', choices: ['A', 'B'] },
];

describe('extraToValues', () => {
  it('maps stored values through and blanks out unset ones', () => {
    const values = extraToValues(definitions, {
      gpa: 3.5,
      scholarship: true,
      // notes + house intentionally absent
    });
    expect(values).toEqual({
      gpa: 3.5,
      scholarship: true,
      notes: '',
      house: '',
    });
  });

  it('treats null the same as missing', () => {
    const values = extraToValues(definitions, { gpa: null });
    expect(values.gpa).toBe('');
  });

  it('handles a missing extra object', () => {
    const values = extraToValues(definitions, undefined);
    expect(values).toEqual({ gpa: '', scholarship: '', notes: '', house: '' });
  });
});

describe('cleanExtra (create)', () => {
  it('drops empty values and coerces types', () => {
    const extra = cleanExtra(definitions, {
      gpa: '3.5',
      scholarship: true,
      notes: '  keep me  ',
      house: '',
    });
    expect(extra).toEqual({ gpa: 3.5, scholarship: true, notes: 'keep me' });
    expect(extra).not.toHaveProperty('house');
  });

  it('ignores a non-finite number', () => {
    const extra = cleanExtra(definitions, { gpa: 'not-a-number' });
    expect(extra).not.toHaveProperty('gpa');
  });

  it('only accepts real booleans for yes/no', () => {
    const extra = cleanExtra(definitions, { scholarship: 'yes' });
    expect(extra).not.toHaveProperty('scholarship');
  });
});

describe('buildExtraPatch (update)', () => {
  it('includes every field, sending blanks as empty strings', () => {
    const extra = buildExtraPatch(definitions, {
      gpa: '4',
      scholarship: false,
      notes: '',
      house: 'A',
    });
    expect(extra).toEqual({
      gpa: 4,
      scholarship: false,
      notes: '',
      house: 'A',
    });
  });

  it('trims free-text values', () => {
    const extra = buildExtraPatch(definitions, { house: '  A  ' });
    expect(extra.house).toBe('A');
  });
});
