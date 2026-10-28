const SAFE_METHOD = /^(GET|HEAD|OPTIONS)$/i;
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

// Read a cookie by name from document.cookie (returns null if absent).
function readCookie(name) {
  if (typeof document === 'undefined') return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + escaped + '=([^;]*)')
  );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

async function readCsrfToken() {
  if (!API_BASE) return readCookie('csrf');
  try {
    // In a Capacitor bundle the page origin is localhost while API cookies
    // belong to the configured panel host. Read that host's native cookie jar.
    const { CapacitorCookies } = await import('@capacitor/core');
    const cookies = await CapacitorCookies.getCookies({ url: API_BASE });
    return cookies.csrf ?? null;
  } catch {
    return readCookie('csrf');
  }
}

export async function request(url, options = {}) {
  const method = (options.method ?? 'GET').toUpperCase();

  // Echo the double-submit CSRF token on state-changing requests. The server
  // sets a readable `csrf` cookie; we send it back in a header it can verify.
  const csrfHeaders = {};
  if (!SAFE_METHOD.test(method)) {
    const token = await readCsrfToken();
    if (token) csrfHeaders['X-CSRF-Token'] = token;
  }

  // Every request in this app sends JSON, so default the content type — but let
  // the browser set it for FormData (it needs to add the multipart boundary),
  // in case a future caller uploads a file.
  const isFormData =
    typeof FormData !== 'undefined' && options.body instanceof FormData;
  const baseHeaders = isFormData ? {} : { 'Content-Type': 'application/json' };

  let response;
  try {
    const target = API_BASE && url.startsWith('/') ? `${API_BASE}${url}` : url;
    response = await fetch(target, {
      ...options,
      credentials: 'include',
      headers: {
        ...baseHeaders,
        ...csrfHeaders,
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Cannot reach the server. Is it running?');
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // the answer had no JSON body
  }

  if (!response.ok) {
    const error = new Error(
      data?.error ??
        `Request failed (status ${response.status}). If this keeps happening, check that the server is running.`
    );
    error.status = response.status;
    error.data = data;
    // Machine-readable twins of the message, for translating errors by code.
    error.code = data?.code ?? null;
    error.params = data?.params ?? null;
    throw error;
  }
  return data;
}
