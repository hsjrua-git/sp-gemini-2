#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Student Panel — interactive setup orchestrator (cross-platform).
//
// This is the "brain" of the installer. It assumes Node.js and the PostgreSQL
// client tools are already present (the platform bootstraps — setup.sh /
// setup.ps1 — install those first, then run this). It is safe to re-run: every
// step checks whether the work is already done and only asks to do what's left.
//
// What it does, in order, asking before anything with side effects:
//   1. Verify Vite's Node floor and that npm + psql are on PATH.
//   2. Collect / reuse configuration (port, host, database connection).
//   3. Ensure the PostgreSQL role + database exist (creating them via a
//      superuser connection only if missing).
//   4. Write server/.env if absent (generating SESSION_SECRET + the app DB
//      password; neither is ever printed).
//   5. npm install in server/ and client/.
//   6. npm run migrate (creates the schema + seeds the default roles).
//   7. Create the first Administrator if none exists (prints a one-time
//      temporary password).
//   8. Build the client.
//   9. Start the server and open the browser once it answers.
//
// Run directly with:  node scripts/setup.mjs
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server');
const CLIENT = path.join(ROOT, 'client');
const ENV_PATH = path.join(SERVER, '.env');
const IS_WIN = process.platform === 'win32';
const NPM = IS_WIN ? 'npm.cmd' : 'npm';

const AUTO_YES = process.argv.includes('--yes') || process.argv.includes('-y');
const rl = createInterface({ input: stdin, output: stdout });

// --- small console helpers -------------------------------------------------
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
let stepNo = 0;
const step = (msg) => console.log(`\n${bold(`[${++stepNo}] ${msg}`)}`);
const ok = (msg) => console.log(green(`  ok ${msg}`));
const info = (msg) => console.log(dim(`  ${msg}`));
const warn = (msg) => console.log(yellow(`  ! ${msg}`));

function die(msg) {
  console.error(`\n${red('Setup stopped: ' + msg)}`);
  rl.close();
  process.exit(1);
}

async function ask(query, def) {
  if (AUTO_YES || !stdin.isTTY) return def || '';
  const suffix = def ? dim(` [${def}]`) : '';
  const answer = (await rl.question(`  ${query}${suffix} `)).trim();
  return answer || def || '';
}

async function confirm(query, def = true) {
  if (AUTO_YES || !stdin.isTTY) return def;
  const hint = def ? 'Y/n' : 'y/N';
  const a = (await rl.question(`  ${query} ${dim(`(${hint})`)} `)).trim().toLowerCase();
  if (!a) return def;
  return a === 'y' || a === 'yes';
}

// A masked password prompt. Falls back to plain input when not a TTY. Used only
// for the optional PostgreSQL superuser password.
function askHidden(query) {
  return new Promise((resolve) => {
    if (AUTO_YES || !stdin.isTTY) {
      resolve(process.env.PG_SUPER_PASSWORD || '');
      return;
    }
    stdout.write('  ' + query);
    // Hand the input stream off from readline; otherwise readline's own
    // keypress handling stays active and echoes the characters we are trying
    // to mask. We reclaim it with rl.resume() once we are done.
    rl.pause();
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    let buf = '';
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        const code = ch.charCodeAt(0);
        if (ch === '\n' || ch === '\r') {
          stdin.setRawMode(wasRaw);
          stdin.removeListener('data', onData);
          rl.resume();
          stdout.write('\n');
          resolve(buf);
          return;
        } else if (code === 3) {
          stdout.write('\n');
          process.exit(130);
        } else if (code === 127 || code === 8) {
          buf = buf.slice(0, -1);
        } else if (code >= 32) {
          buf += ch;
        }
      }
    };
    stdin.on('data', onData);
  });
}
// --- process helpers -------------------------------------------------------

// Run a command with inherited stdio (the user sees live output). Resolves the
// exit code. Used for npm install / migrate / build where progress matters.
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      // npm on Windows is a .cmd shim, so it needs a shell. We only use a shell
      // for npm (which never takes user-supplied arguments here), never for
      // psql, to avoid shell-quoting concerns with names the user typed.
      shell: IS_WIN && cmd === NPM,
      ...opts,
    });
    child.on('error', (err) => resolve({ code: -1, error: err }));
    child.on('close', (code) => resolve({ code }));
  });
}

// Run a command and capture output. `input` is written to stdin (used to feed
// SQL to psql without putting secrets on the command line / in `ps`).
function capture(cmd, args, { input, env } = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    input,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return {
    code: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    error: res.error,
  };
}

function have(cmd) {
  // On Windows, .cmd shims (like npm.cmd) must be run through a shell; native
  // executables (node, psql) must not (and take no user input here anyway).
  const useShell = IS_WIN && cmd.endsWith('.cmd');
  const v = spawnSync(cmd, ['--version'], { encoding: 'utf8', shell: useShell });
  return v.status === 0;
}

// --- step 1: prerequisites -------------------------------------------------
function checkPrerequisites() {
  step('Checking prerequisites (Node, npm, PostgreSQL client)');

  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeSupported =
    (major === 20 && minor >= 19) ||
    (major === 22 && minor >= 12) ||
    major > 22;
  if (!nodeSupported) {
    die(`Node.js 20.19+ or 22.12+ is required (found ${process.versions.node}). Re-run the ` +
      `platform bootstrap (setup.sh / setup.ps1) to install a newer Node.`);
  }
  ok(`Node.js ${process.versions.node}`);

  if (!have(NPM)) die('npm was not found on PATH.');
  ok('npm is available');

  if (!have('psql')) {
    warn('The PostgreSQL client tools (psql) were not found on PATH.');
    die('psql is required. Install PostgreSQL, then re-run.');
  }
  ok('psql is available');
}

// --- step 2: configuration -------------------------------------------------
function parseExistingEnv() {
  if (!fs.existsSync(ENV_PATH)) return null;
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  const get = (key) => {
    const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim() : undefined;
  };
  return { url: get('DATABASE_URL'), port: get('PORT'), host: get('HOST') };
}

function urlToConfig(url) {
  const u = new URL(url); // postgres://user:pass@host:port/dbname
  return {
    host: u.hostname || 'localhost',
    port: u.port || '5432',
    dbName: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'student_panel',
    dbUser: decodeURIComponent(u.username) || 'student_panel',
    dbPassword: decodeURIComponent(u.password) || '',
  };
}

function buildUrl(c) {
  const user = encodeURIComponent(c.dbUser);
  const pass = encodeURIComponent(c.dbPassword);
  return `postgres://${user}:${pass}@${c.host}:${c.port}/${c.dbName}`;
}

async function gatherConfig() {
  step('Configuration');
  const existing = parseExistingEnv();
  if (existing?.url) {
    info('Found an existing server/.env — reusing its database settings.');
    const c = urlToConfig(existing.url);
    c.appPort = existing.port || '3000';
    c.appHost = existing.host || '0.0.0.0';
    c.reuseEnv = true;
    ok(`Database "${c.dbName}" on ${c.host}:${c.port} as "${c.dbUser}"`);
    return c;
  }

  info("No server/.env yet — let's set the basics (press Enter for defaults).");
  const appPort = await ask('Port the app listens on?', '3000');
  const appHost = await ask('Bind address (0.0.0.0 = whole LAN, 127.0.0.1 = this PC only)?', '0.0.0.0');
  const host = await ask('PostgreSQL host?', 'localhost');
  const port = await ask('PostgreSQL port?', '5432');
  const dbName = await ask('Database name to use/create?', 'student_panel');
  const dbUser = await ask('Application database user to use/create?', 'student_panel');
  // The app user's password is generated, stored only in .env, and never shown.
  const dbPassword = randomBytes(24).toString('base64url');
  return { host, port, dbName, dbUser, dbPassword, appPort, appHost, reuseEnv: false };
}
// --- step 3: database ------------------------------------------------------

// psql environment for connecting AS THE APP USER to the app database.
function appPgEnv(c) {
  return {
    PGHOST: c.host, PGPORT: c.port, PGDATABASE: c.dbName,
    PGUSER: c.dbUser, PGPASSWORD: c.dbPassword,
  };
}

// Can we already connect as the app user to the app database?
function appDbReachable(c) {
  const r = capture('psql', ['-tAc', 'SELECT 1'], { env: appPgEnv(c) });
  return r.code === 0 && r.stdout.startsWith('1');
}

function requireSupportedPostgres(c) {
  const result = capture('psql', ['-tAc', 'SHOW server_version_num'], {
    env: appPgEnv(c),
  });
  const version = Number(result.stdout);
  if (result.code !== 0 || !Number.isInteger(version)) {
    die('Could not read the connected PostgreSQL server version.');
  }
  if (version < 150000) {
    const shown = capture('psql', ['-tAc', 'SHOW server_version'], {
      env: appPgEnv(c),
    }).stdout || String(version);
    die(
      `PostgreSQL 15+ is required (connected server: ${shown}). ` +
        'Upgrade PostgreSQL, then re-run setup.'
    );
  }
  ok(`PostgreSQL server ${Math.floor(version / 10000)} is supported.`);
}

// Run SQL as a superuser. SQL is fed on stdin (never argv), so no secret ever
// appears in the process list. On Linux we try the local `postgres` OS account
// via sudo (peer auth, usually no DB password). Otherwise we connect over TCP
// as the `postgres` role; psql prompts for that password (masked by psql).
function runSuperSql(c, sql, { linuxSudo }) {
  if (linuxSudo) {
    return capture('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-X'], { input: sql });
  }
  const env = c.superPassword ? { PGPASSWORD: c.superPassword } : {};
  return capture(
    'psql',
    ['-h', c.host, '-p', c.port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X'],
    { input: sql, env }
  );
}

async function ensureDatabase(c) {
  step('PostgreSQL database and role');

  if (appDbReachable(c)) {
    ok(`Connected to "${c.dbName}" as "${c.dbUser}" — already set up.`);
    return;
  }

  info(`Cannot connect to "${c.dbName}" as "${c.dbUser}" yet — it needs creating.`);
  if (!(await confirm(`Create the role "${c.dbUser}" and database "${c.dbName}" now?`))) {
    die('Database not set up. Create it manually, set DATABASE_URL in server/.env, then re-run.');
  }

  let linuxSudo = false;
  if (process.platform === 'linux' && have('sudo')) {
    info('Trying the local "postgres" account via sudo (you may be asked for your sudo password).');
    const probe = runSuperSql(c, 'SELECT 1;', { linuxSudo: true });
    linuxSudo = probe.code === 0;
    if (!linuxSudo) info('sudo path unavailable — will connect as the "postgres" role over the network instead.');
  }
  if (!linuxSudo) {
    info('Connecting as the PostgreSQL superuser "postgres".');
    c.superPassword = await askHidden('Password for the "postgres" role (blank to try trust/no password): ');
  }

  // Idempotent bootstrap SQL. Names and the generated password are passed as
  // psql variables and re-quoted by SQL's format() with %I (identifier) and %L
  // (literal), so nothing the user typed is concatenated into raw SQL. The
  // `\gexec` runs the composed statement only when the WHERE finds it missing
  // (zero rows => nothing runs, no error). Delivered on stdin, so no secret
  // appears in the process list.
  const q = (v) => String(v).replace(/'/g, "''");
  const sql = [
    `\\set app_user '${q(c.dbUser)}'`,
    `\\set app_pw '${q(c.dbPassword)}'`,
    `\\set db_name '${q(c.dbName)}'`,
    `SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_pw')`,
    `  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')\\gexec`,
    `SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'app_user')`,
    `  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name')\\gexec`,
  ].join('\n');

  const res = runSuperSql(c, sql, { linuxSudo });
  if (res.code !== 0) {
    console.error(res.stderr || res.stdout);
    die('Could not create the database/role. Check the superuser access and that PostgreSQL is running.');
  }

  if (!appDbReachable(c)) {
    console.error(capture('psql', ['-tAc', 'SELECT 1'], { env: appPgEnv(c) }).stderr);
    die('Created the objects but still cannot connect as the app user. Check that pg_hba.conf allows password auth on localhost.');
  }
  ok(`Role "${c.dbUser}" and database "${c.dbName}" are ready.`);
}

// --- step 4: write .env ----------------------------------------------------
async function ensureEnv(c) {
  step('Server configuration file (server/.env)');
  if (c.reuseEnv && fs.existsSync(ENV_PATH)) {
    ok('server/.env already exists — leaving it untouched.');
    return;
  }
  // 48 random bytes hex = 96 chars, comfortably over the 32-char minimum.
  const sessionSecret = randomBytes(48).toString('hex');
  const contents = [
    '# Generated by scripts/setup.mjs. Do not commit this file.',
    `DATABASE_URL=${buildUrl(c)}`,
    `SESSION_SECRET=${sessionSecret}`,
    `PORT=${c.appPort}`,
    `HOST=${c.appHost}`,
    'NODE_ENV=production',
    'SESSION_COOKIE_SECURE=auto',
    'TRUST_PROXY=0',
    'CSRF_CHECK_ORIGIN=auto',
    'CSRF_ALLOWED_ORIGINS=',
    'ALLOW_SAMPLE_DATA=0',
    '',
  ].join('\n');
  await fsp.writeFile(ENV_PATH, contents, { mode: 0o600 });
  ok('Wrote server/.env (SESSION_SECRET and DB password generated; not shown).');
}
// --- step 5: dependencies --------------------------------------------------
async function installDependencies() {
  step('Installing dependencies (server, then client)');
  info('This can take a few minutes the first time.');
  const s = await run(NPM, ['install'], { cwd: SERVER });
  if (s.code !== 0) die('npm install failed in server/.');
  ok('Server dependencies installed.');
  const c = await run(NPM, ['install'], { cwd: CLIENT });
  if (c.code !== 0) die('npm install failed in client/.');
  ok('Client dependencies installed.');
}

// --- step 6: migrations ----------------------------------------------------
async function runMigrations() {
  step('Creating database tables (migrations)');
  const r = await run('node', ['--env-file=.env', 'src/db/migrate.js'], { cwd: SERVER });
  if (r.code !== 0) die('Migrations failed.');
  ok('Schema is up to date and default roles are seeded.');
}

// --- step 7: first administrator ------------------------------------------
function adminExists(c) {
  const r = capture(
    'psql',
    ['-tAc', "SELECT count(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'Administrator' AND u.is_active"],
    { env: appPgEnv(c) }
  );
  return r.code === 0 && Number(r.stdout) > 0;
}

async function ensureAdmin(c) {
  step('First administrator account');
  if (adminExists(c)) {
    ok('An active Administrator already exists — skipping.');
    return;
  }
  info('No administrator yet. Let\'s create one now.');
  let username = '';
  while (!username) username = (await ask('Username for the administrator?', 'admin')).trim();
  let fullName = '';
  while (!fullName) fullName = (await ask('Full name?', 'Site Administrator')).trim();

  // Call the existing createUser script directly (no shell, so spaces in the
  // full name are safe). It prints a one-time temporary password.
  console.log();
  const r = await run('node', ['--env-file=.env', 'src/scripts/createUser.js', username, fullName], { cwd: SERVER });
  if (r.code !== 0) die('Creating the administrator failed.');
  warn('Note the temporary password above — you must change it at first login.');
}

// --- step 8: build ---------------------------------------------------------
async function buildClient() {
  step('Building the front end');
  const r = await run(NPM, ['run', 'build'], { cwd: CLIENT });
  if (r.code !== 0) die('Client build failed.');
  ok('Client built to client/dist.');
}

// --- step 9: run + open browser -------------------------------------------
function waitForHealth(port, timeoutMs = 30000) {
  const url = `http://127.0.0.1:${port}/api/health`;
  const start = Date.now();
  return new Promise((resolve) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tryOnce, 700);
    };
    tryOnce();
  });
}

function openBrowser(url) {
  try {
    if (IS_WIN) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* best effort */
  }
}

async function startAndOpen(c) {
  step('Starting the server');
  const url = `http://localhost:${c.appPort}`;
  info(`Launching the app. It will open at ${bold(url)} once ready.`);
  info('Leave this window open to keep the server running; press Ctrl-C to stop.');

  const server = spawn(NPM, ['start'], {
    cwd: SERVER,
    stdio: 'inherit',
    shell: IS_WIN,
  });
  server.on('close', (code) => process.exit(code ?? 0));

  const healthy = await waitForHealth(c.appPort);
  if (healthy) {
    ok('Server is up.');
    openBrowser(url);
    console.log(`\n${green(bold('Student Panel is running at ' + url))}`);
  } else {
    warn('The server did not answer a health check in time. Check the log above.');
    warn(`If it is running, open ${url} manually.`);
  }
}

// --- main ------------------------------------------------------------------
async function main() {
  console.log(bold('\nStudent Panel — setup\n'));
  info(`Project root: ${ROOT}`);
  try {
    checkPrerequisites();
    const c = await gatherConfig();
    await ensureDatabase(c);
    requireSupportedPostgres(c);
    await ensureEnv(c);
    await installDependencies();
    await runMigrations();
    await ensureAdmin(c);
    await buildClient();
    rl.close();
    await startAndOpen(c); // takes over the terminal
  } catch (err) {
    die(err?.message || String(err));
  }
}

main();

