import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCsrf } from '../src/middleware/csrf.js';

// Minimal Express-ish req/res doubles.
function makeReq({ method = 'GET', cookie, origin, referer, host = 'panel.example.com', csrfHeader, secure } = {}) {
  const headers = {
    cookie,
    origin,
    referer,
    host,
    'x-csrf-token': csrfHeader,
  };
  return {
    method,
    secure,
    headers: { cookie },
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
}

function makeRes() {
  return {
    statusCode: null,
    body: null,
    cookies: [],
    cookie(name, value, options) {
      this.cookies.push({ name, value, options });
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function runMiddleware(mw, req, res) {
  let called = false;
  mw(req, res, () => {
    called = true;
  });
  return called; // true => passed through to next()
}

const { issue, checkOrigin, verifyToken } = createCsrf({ secure: 'auto' });

test('issue sets a readable csrf cookie only when one is absent', () => {
  const res1 = makeRes();
  assert.equal(runMiddleware(issue, makeReq(), res1), true);
  assert.equal(res1.cookies.length, 1);
  const cookie = res1.cookies[0];
  assert.equal(cookie.name, 'csrf');
  assert.ok(cookie.value.length >= 32);
  assert.equal(cookie.options.httpOnly, false); // the SPA must read it
  assert.equal(cookie.options.sameSite, 'lax');

  const res2 = makeRes();
  assert.equal(runMiddleware(issue, makeReq({ cookie: 'csrf=already' }), res2), true);
  assert.equal(res2.cookies.length, 0); // left the existing token alone
});

test("issue resolves secure:'auto' from the connection, not the literal string", () => {
  // res.cookie's `secure` is a plain boolean: passing the string 'auto' straight
  // through would be truthy and mark the cookie Secure even over plain HTTP, so
  // the browser would drop it and every mutation would then fail verifyToken.
  const http = makeRes();
  runMiddleware(issue, makeReq({ secure: false }), http);
  assert.equal(http.cookies[0].options.secure, false); // sendable over HTTP LAN

  const https = makeRes();
  runMiddleware(issue, makeReq({ secure: true }), https);
  assert.equal(https.cookies[0].options.secure, true);
});

test('issue honours an explicit secure boolean regardless of the connection', () => {
  const forced = createCsrf({ secure: true });
  const res = makeRes();
  runMiddleware(forced.issue, makeReq({ secure: false }), res);
  assert.equal(res.cookies[0].options.secure, true);

  const off = createCsrf({ secure: false });
  const res2 = makeRes();
  runMiddleware(off.issue, makeReq({ secure: true }), res2);
  assert.equal(res2.cookies[0].options.secure, false);
});

test('checkOrigin lets safe methods and same-origin writes through', () => {
  assert.equal(runMiddleware(checkOrigin, makeReq({ method: 'GET', origin: 'https://evil.test' }), makeRes()), true);
  assert.equal(
    runMiddleware(checkOrigin, makeReq({ method: 'POST', origin: 'https://panel.example.com' }), makeRes()),
    true
  );
});

test('checkOrigin allows a mutation that carries neither Origin nor Referer', () => {
  // Browsers attach Origin on cross-site writes; a bare request is a non-browser
  // client, which is not a CSRF vector.
  assert.equal(runMiddleware(checkOrigin, makeReq({ method: 'POST' }), makeRes()), true);
});

test('checkOrigin refuses a cross-origin write', () => {
  const res = makeRes();
  assert.equal(
    runMiddleware(checkOrigin, makeReq({ method: 'POST', origin: 'https://evil.test' }), res),
    false
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'CSRF_ORIGIN');
});

test('checkOrigin permits an explicitly trusted native-app origin', () => {
  const native = createCsrf({
    secure: true,
    enforceOrigin: true,
    allowedOrigins: ['https://localhost'],
  });
  assert.equal(
    runMiddleware(
      native.checkOrigin,
      makeReq({ method: 'POST', origin: 'https://localhost' }),
      makeRes()
    ),
    true
  );
});

test('checkOrigin also honours the Referer host when there is no Origin', () => {
  const ok = makeRes();
  assert.equal(
    runMiddleware(checkOrigin, makeReq({ method: 'PATCH', referer: 'https://panel.example.com/x' }), ok),
    true
  );
  const bad = makeRes();
  assert.equal(
    runMiddleware(checkOrigin, makeReq({ method: 'PATCH', referer: 'https://evil.test/x' }), bad),
    false
  );
  assert.equal(bad.statusCode, 403);
});

test('checkOrigin is a no-op when origin enforcement is disabled (dev/proxy)', () => {
  const dev = createCsrf({ secure: 'auto', enforceOrigin: false });
  assert.equal(
    runMiddleware(dev.checkOrigin, makeReq({ method: 'POST', origin: 'https://evil.test' }), makeRes()),
    true
  );
});

test('verifyToken passes only when header matches the cookie', () => {
  assert.equal(runMiddleware(verifyToken, makeReq({ method: 'GET' }), makeRes()), true);

  const match = makeReq({ method: 'POST', cookie: 'csrf=abc123', csrfHeader: 'abc123' });
  assert.equal(runMiddleware(verifyToken, match, makeRes()), true);

  const missing = makeRes();
  assert.equal(
    runMiddleware(verifyToken, makeReq({ method: 'POST', cookie: 'csrf=abc123' }), missing),
    false
  );
  assert.equal(missing.statusCode, 403);
  assert.equal(missing.body.code, 'CSRF');

  const mismatch = makeRes();
  assert.equal(
    runMiddleware(verifyToken, makeReq({ method: 'POST', cookie: 'csrf=abc123', csrfHeader: 'nope456' }), mismatch),
    false
  );
  assert.equal(mismatch.statusCode, 403);
});

test('issue and verifyToken tolerate malformed percent-encoded cookies without throwing URIError', () => {
  const res = makeRes();
  assert.equal(
    runMiddleware(issue, makeReq({ cookie: 'broken=%E0%A4%A; csrf=abc123' }), res),
    true
  );
  assert.equal(res.cookies.length, 0);

  const ok = makeRes();
  assert.equal(
    runMiddleware(
      verifyToken,
      makeReq({ method: 'POST', cookie: 'broken=%; csrf=abc123', csrfHeader: 'abc123' }),
      ok
    ),
    true
  );
});
