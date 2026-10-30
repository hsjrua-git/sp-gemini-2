import { describe, it, expect } from 'vitest';
import {
  normalizeTheme,
  normalizePalette,
  normalizeCustomCursor,
} from './theme.js';

describe('normalizeTheme', () => {
  it('keeps the three supported themes', () => {
    expect(normalizeTheme('system')).toBe('system');
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');
  });

  it('falls back to dark (the default) for anything unrecognised', () => {
    expect(normalizeTheme('solarized')).toBe('dark');
    expect(normalizeTheme(null)).toBe('dark');
    expect(normalizeTheme(undefined)).toBe('dark');
  });
});

describe('normalizePalette', () => {
  it('supports aurum (solid grey-yellow) and aurum-glass (glassmorphism grey-yellow)', () => {
    expect(normalizePalette('aurum')).toBe('aurum');
    expect(normalizePalette('aurum-glass')).toBe('aurum-glass');
    expect(normalizePalette('unknown')).toBe('aurora');
  });
});

describe('normalizeCustomCursor', () => {
  it('normalizes boolean and string representations', () => {
    expect(normalizeCustomCursor(true)).toBe(true);
    expect(normalizeCustomCursor(false)).toBe(false);
    expect(normalizeCustomCursor('false')).toBe(false);
    expect(normalizeCustomCursor(null)).toBe(true);
  });
});
