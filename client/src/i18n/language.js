// Language state lives in three places, exactly like the theme: a remembered
// draft in localStorage (applied at boot, so the login screen is already in
// the right language before anyone signs in), the signed-in user's stored
// preference (authoritative once loaded), and the i18n instance itself. This
// module holds the pure helpers + the document sync; i18n/index.js wires them
// to the i18next instance.

export const LANGUAGES = ['fa', 'en'];
export const DEFAULT_LANGUAGE = 'fa';
const DRAFT_KEY = 'studentPanelLanguage';
const RTL_LANGUAGES = new Set(['fa']);

export function normalizeLanguage(value) {
  // Persian is the default: an unset, invalid, or missing choice falls back
  // to 'fa' rather than to the browser locale.
  return LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

export function isRtl(language) {
  return RTL_LANGUAGES.has(normalizeLanguage(language));
}

export function rememberedLanguage() {
  try {
    return normalizeLanguage(localStorage.getItem(DRAFT_KEY));
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

// Point <html lang/dir> at the active language so browser chrome (font
// selection, screen readers, direction-dependent CSS) follows it.
export function applyDocumentLanguage(language) {
  const value = normalizeLanguage(language);
  document.documentElement.lang = value;
  document.documentElement.dir = isRtl(value) ? 'rtl' : 'ltr';
  return value;
}

// The draft is what the login screen switches; once signed in, the stored
// preference takes over (and is itself written through the same draft, so the
// next visit starts in the last language used).
export function rememberLanguageDraft(language) {
  try {
    localStorage.setItem(DRAFT_KEY, normalizeLanguage(language));
  } catch {
    // storage may be unavailable; the language still applies for this visit
  }
}
