import { randomBytes, timingSafeEqual } from 'node:crypto';

// CSRF defence for the API. Two independent, cheap checks that back each other
// up (defence in depth on top of the session cookie's SameSite=lax):
//
//   1. Origin check — a browser always attaches an Origin (or at least a
//      Referer) on cross-site state-changing requests and cannot be scripted to
//      forge it, so we refuse any mutation whose Origin/Referer host isn't ours.
//      Requests with neither header are allowed: browsers send one on
//      cross-origin writes, and non-browser clients (which don't carry the
//      victim's cookies) aren't a CSRF vector.
//
//   2. Double-submit token — we set a readable `csrf` cookie and require the
//      same value echoed in an X-CSRF-Token header on mutations. An attacker's
//      cross-site page cannot read our cookie, so it cannot echo it back.
//
// Verification runs *after* requireLogin (see index.js), so an unauthenticated
// mutation still fails as 401 rather than leaking that it also lacks a token.
// The Origin check runs earlier so it can also cover the login route.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const COOKIE_NAME = 'csrf';

function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    const rawValue = part.slice(eq + 1).trim();
    try {
      jar[key] = decodeURIComponent(rawValue);
    } catch {
      jar[key] = rawValue;
    }
  }
  return jar;
}

function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  // Constant-time compare so a wrong token can't be recovered by timing.
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hostOf(value) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

// `secure` mirrors the session cookie's Secure setting (see index.js) so the two
// cookies behave identically across HTTP-LAN and HTTPS deployments. It may be
// `true`, `false`, or the string `'auto'` (the express-session value): `'auto'`
// is resolved per request from `req.secure`, which honours a trusted proxy's
// X-Forwarded-Proto. This matters because `res.cookie`'s own `secure` option is
// a plain boolean — passing the string `'auto'` straight through would be truthy
// and mark the cookie Secure even over plain HTTP, so the browser would drop it
// and every authenticated mutation would then fail the double-submit check. That
// silently breaks the default LAN-over-HTTP deployment when reached from another
// machine (localhost is exempt, since browsers treat it as a secure context).
//
// `enforceOrigin` should be on only when the API and the client share an origin
// — i.e. the single-process production build where this server also serves the
// SPA. In development the Vite dev server proxies /api from a different port, so
// the Origin (Vite) and Host (this server) legitimately differ; enforcing there
// would reject every dev mutation. The double-submit token still runs in both
// modes, so development keeps its CSRF protection either way.
export function createCsrf({ secure, enforceOrigin = true, allowedOrigins = [] }) {
  const allowed = new Set(allowedOrigins);
  // Resolve the effective Secure flag for THIS request. `res.cookie` needs a
  // boolean, and 'auto' means "Secure only when the connection is HTTPS".
  function secureFor(req) {
    return secure === 'auto' ? req.secure : secure;
  }

  // Ensure the browser has a token to echo back. Set it only when absent so a
  // token stays stable across concurrent requests.
  function issue(req, res, next) {
    const existing = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!existing) {
      const token = randomBytes(32).toString('base64url');
      res.cookie(COOKIE_NAME, token, {
        httpOnly: false, // the SPA must read it to echo it in the header
        sameSite: 'lax',
        secure: secureFor(req),
        path: '/',
      });
    }
    next();
  }

  function checkOrigin(req, res, next) {
    if (!enforceOrigin || SAFE_METHODS.has(req.method)) return next();
    const source = req.get('origin') ?? req.get('referer');
    let sourceOrigin = null;
    try {
      sourceOrigin = source ? new URL(source).origin : null;
    } catch {
      sourceOrigin = null;
    }
    if (source && hostOf(source) !== req.get('host') && !allowed.has(sourceOrigin)) {
      return res
        .status(403)
        .json({ error: 'Cross-origin request refused.', code: 'CSRF_ORIGIN' });
    }
    next();
  }

  function verifyToken(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const cookieToken = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const headerToken = req.get('x-csrf-token');
    if (!cookieToken || !headerToken || !sameToken(cookieToken, headerToken)) {
      return res.status(403).json({
        error: 'Your session token is missing or stale. Reload the page and try again.',
        code: 'CSRF',
      });
    }
    next();
  }

  return { issue, checkOrigin, verifyToken };
}
