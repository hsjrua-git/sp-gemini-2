import assert from 'node:assert/strict';
import { createCsrf } from '../../server/src/middleware/csrf.js';

const { verifyToken } = createCsrf({ secure: false });
let status;
const req = { method: 'POST', headers: { cookie: 'csrf=%C3%A9' }, get: () => 'a' };
const res = { status(value) { status = value; return this; }, json(body) { return body; } };
let thrown;
try { verifyToken(req, res, () => assert.fail('mismatching token was accepted')); }
catch (error) { thrown = error; }
console.log(JSON.stringify({ status: status ?? null, error: thrown?.code ?? null }));
assert.equal(thrown, undefined, 'invalid CSRF input must be rejected rather than throw');
assert.equal(status, 403);
