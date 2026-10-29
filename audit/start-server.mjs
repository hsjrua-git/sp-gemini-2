import { randomBytes } from 'node:crypto';

// Dedicated audit process: never load the project's .env or target port 3000.
process.env.DATABASE_URL = 'postgresql://audit_owner@127.0.0.1:55439/student_panel_audit';
process.env.HOST = '127.0.0.1';
process.env.PORT = '3300';
process.env.NODE_ENV = 'production';
process.env.SESSION_SECRET = randomBytes(48).toString('hex');
process.env.SESSION_COOKIE_SECURE = 'false';
process.env.CSRF_CHECK_ORIGIN = 'true';
process.env.TRUST_PROXY = 'false';
process.env.CSRF_ALLOWED_ORIGINS = '';
await import('../server/src/index.js');
