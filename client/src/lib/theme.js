const STORAGE_KEY = 'studentPanelTheme';
const PALETTE_KEY = 'studentPanelPalette';
const CURSOR_KEY = 'studentPanelCustomCursor';
const THEMES = ['system', 'light', 'dark'];
// 'aurora' is the built-in default: it maps to *no* data-palette attribute, so
// the signature grey base + top-edge glow tokens at the top of index.css apply
// untouched. Every other palette sets [data-palette] and lets the stylesheet
// recolor the interface. 'cobalt' and 'crimson' are the CyFocus-style palettes:
// they keep the neutral grey/charcoal shell and only re-hue the accent + the
// top-edge glow (cool-blue / crimson-red); 'aurum' and 'aurum-glass' provide
// the solid and glassmorphism grey-yellow themes.
const PALETTES = [
  'aurora',
  'gradebook',
  'midnight',
  'ember',
  'meadow',
  'cobalt',
  'crimson',
  'aurum',
  'aurum-glass',
];

export function normalizeTheme(value) {
  // Dark-first: an unset or invalid theme falls back to dark (the default
  // look). 'system' and 'light' remain fully selectable.
  return THEMES.includes(value) ? value : 'dark';
}

export function normalizePalette(value) {
  return PALETTES.includes(value) ? value : 'aurora';
}

export function normalizeCustomCursor(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'false' || value === '0') return false;
  if (value === 'true' || value === '1') return true;
  return true;
}

function setPaletteAttribute(palette) {
  const value = normalizePalette(palette);
  if (value === 'aurora') {
    delete document.documentElement.dataset.palette;
  } else {
    document.documentElement.dataset.palette = value;
  }
}

function setCursorAttribute(enabled) {
  const active = normalizeCustomCursor(enabled);
  document.documentElement.dataset.customCursor = active ? 'on' : 'off';
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('custom-cursor-change', { detail: active }));
  }
}

export function applyTheme(theme) {
  const value = normalizeTheme(theme);
  document.documentElement.dataset.theme = value;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // storage may be unavailable; the theme still applies for this visit
  }
}

export function applyPalette(palette) {
  const value = normalizePalette(palette);
  setPaletteAttribute(value);
  try {
    localStorage.setItem(PALETTE_KEY, value);
  } catch {
    // storage may be unavailable; the palette still applies for this visit
  }
}

export function applyCustomCursor(enabled) {
  const value = normalizeCustomCursor(enabled);
  setCursorAttribute(value);
  try {
    localStorage.setItem(CURSOR_KEY, value ? 'true' : 'false');
  } catch {
    // ignore
  }
}

export function getRememberedCustomCursor() {
  try {
    return normalizeCustomCursor(localStorage.getItem(CURSOR_KEY));
  } catch {
    return true;
  }
}

// Applied at boot (main.jsx) before preferences load, so the remembered theme
// and palette are painted immediately and there's no flash of the default.
export function applyRememberedTheme() {
  let storedTheme = null;
  let storedPalette = null;
  let storedCursor = null;
  try {
    storedTheme = localStorage.getItem(STORAGE_KEY);
    storedPalette = localStorage.getItem(PALETTE_KEY);
    storedCursor = localStorage.getItem(CURSOR_KEY);
  } catch {
    // ignore
  }
  document.documentElement.dataset.theme = normalizeTheme(storedTheme);
  setPaletteAttribute(storedPalette);
  setCursorAttribute(storedCursor);
}
