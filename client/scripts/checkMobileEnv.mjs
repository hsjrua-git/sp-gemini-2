import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const file = path.resolve('.env.mobile.local');
if (!fs.existsSync(file)) {
  console.error('Missing client/.env.mobile.local. Copy mobile.env.example and set VITE_API_BASE_URL.');
  process.exit(1);
}
const match = fs.readFileSync(file, 'utf8').match(/^VITE_API_BASE_URL=(.+)$/m);
let url;
try {
  url = new URL(match?.[1]?.trim() ?? '');
} catch {
  console.error('VITE_API_BASE_URL must be an absolute http(s) URL.');
  process.exit(1);
}
if (url.protocol !== 'https:' && process.env.ALLOW_INSECURE_MOBILE !== '1') {
  console.error('Mobile builds require HTTPS. Set ALLOW_INSECURE_MOBILE=1 only for a temporary LAN/emulator build.');
  process.exit(1);
}
console.log(`Mobile API origin: ${url.origin}`);
