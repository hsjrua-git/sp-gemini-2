import i18next from './index.js';

// Translate an error thrown by api/http.js by its machine-readable code,
// falling back to the server's English message. `params` (when present)
// carries the interpolation values the translation needs ({{max}},
// {{entity}}, …). Anything without a code — network failures, untranslated
// fallbacks, plain Errors — renders its message unchanged.
export function errorMessage(error) {
  if (!error) return '';
  const code = error.code;
  if (code && i18next.exists(`errors:${code}`)) {
    const params = { ...(error.params ?? {}) };
    // The server passes entity names as stable keys ('session', 'task'); the
    // message needs them in the active language.
    if (params.entity && i18next.exists(`errors:entities.${params.entity}`)) {
      params.entity = i18next.t(`errors:entities.${params.entity}`);
    }
    return i18next.t(`errors:${code}`, params);
  }
  return error.message;
}
