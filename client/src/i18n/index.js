// The i18next instance. Locale files are plain JSON split by namespace
// (common = chrome + shared actions, nav = sidebar/topbar labels,
// errors = the server's error-code catalogue, one key per code); they are
// imported statically — the whole catalogue is a few tens of kilobytes, far
// cheaper than loading machinery. `i18n/parity.test.js` keeps fa and en in
// lockstep, so a missing key can never ship.

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  applyDocumentLanguage,
  rememberedLanguage,
  rememberLanguageDraft,
} from './language.js';

export * from './language.js';

// Locale files are plain JSON, one namespace per file (common = chrome +
// shared actions, nav = sidebar/topbar labels, errors = the server's
// error-code catalogue, one key per code, plus one file per page). Vite's
// import.meta.glob registers every file that exists in fa/ and en/ — adding a
// page's translations means dropping two JSON files in, nothing else. The
// parity test keeps the two languages in lockstep.
const faModules = import.meta.glob('./fa/*.json', { eager: true });
const enModules = import.meta.glob('./en/*.json', { eager: true });

function bundles(modules) {
  const byNamespace = {};
  for (const [modulePath, module] of Object.entries(modules)) {
    const namespace = modulePath.split('/').pop().replace(/\.json$/, '');
    byNamespace[namespace] = module.default;
  }
  return byNamespace;
}

const fa = bundles(faModules);
const en = bundles(enModules);
const namespaces = [...new Set([...Object.keys(fa), ...Object.keys(en)])];

const initial = rememberedLanguage();

void i18next.use(initReactI18next).init({
  resources: { fa, en },
  lng: initial,
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: namespaces,
  // React already escapes interpolated values; i18next must not double-escape.
  interpolation: { escapeValue: false },
  // An empty string in a locale file means "not translated yet" — fall
  // through to the fallback language instead of rendering nothing.
  returnEmptyString: false,
});

applyDocumentLanguage(initial);

// The single entry point for switching: i18n, the document root, and the
// remembered draft always move together.
export function setLanguage(language) {
  const value = applyDocumentLanguage(language);
  rememberLanguageDraft(value);
  void i18next.changeLanguage(value);
  return value;
}

export default i18next;
