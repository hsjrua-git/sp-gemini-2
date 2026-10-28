# Building the mobile app (Capacitor)

This turns the on-device build of Student Panel into a native Android app. The
whole app — UI, business logic, and the PostgreSQL-compatible database (PGlite,
running as WebAssembly and persisting to the WebView's IndexedDB) — runs inside
the app. There is no server, no network, and no PC involved once it is installed.

Everything below is run from the `client/` directory unless noted. **These steps
have not been run in this environment** (no Android SDK / JDK / device here), so
treat them as the exact sequence to run on your own machine and adjust versions
if your toolchain differs.

## Prerequisites (install once, on your machine)

- **Node.js ≥ 20** and npm (same as the web build).
- **Android Studio** (includes the Android SDK and an emulator). Install it and
  open it once so it finishes downloading the default SDK + platform tools.
- **JDK 21** (Android Studio bundles a compatible JDK; a standalone JDK also
  works). Capacitor 7 targets modern Android toolchains.
- For a physical phone: enable Developer Options + USB debugging, or use the
  Android Studio emulator instead.

> iOS is **not** covered here: building an iOS app requires macOS + Xcode. The
> same project supports it — run `npm run build`, `npx cap add ios`, then
> `npx cap open ios` on a Mac — but it cannot be done from Windows/Linux.

## One-time project setup

The Capacitor config and dependencies are already committed:

- `client/capacitor.config.json` — `appId` `app.studentpanel.mobile`,
  `appName` "Student Panel", `webDir` `dist` (Vite's build output).
- `client/package.json` — `@capacitor/core`, `@capacitor/android` (deps) and
  `@capacitor/cli` (dev dep), plus the `cap:*` scripts below.

Install dependencies and add the Android platform:

```bash
cd client
npm install
npm run build            # produces dist/ — Capacitor copies this into the app
npm run cap:add:android  # creates client/android/ (first time only)
```

`npm run cap:add:android` generates the native `android/` project. It is
git-ignored by default (see `client/.gitignore`) because it is reproducible from
`dist/` + `capacitor.config.json`; delete those two lines in `.gitignore` if you
prefer to commit and customize it.

## Build, sync, and run

Whenever you change the web app, rebuild and sync so the native shell picks up
the new `dist/`:

```bash
cd client
npm run cap:sync            # = vite build && cap sync (copies dist/ + updates native deps)
```

Then open it in Android Studio and press Run, or go straight to a device:

```bash
npm run cap:open:android    # opens client/android/ in Android Studio
# — or —
npm run cap:run:android     # build + sync + install/launch on a connected device/emulator
```

The `cap:*` scripts:

| Script | Does |
| --- | --- |
| `npm run cap:add:android` | Create the native `android/` project (first time only). |
| `npm run cap:sync` | `vite build` then `cap sync` — the normal rebuild step. |
| `npm run cap:open:android` | Open the Android project in Android Studio. |
| `npm run cap:run:android` | Build + sync + install and launch on a device/emulator. |

## Producing an installable APK / AAB

In Android Studio (opened via `cap:open:android`):

- **Build → Build Bundle(s) / APK(s) → Build APK(s)** for a debug APK you can
  sideload to your own phone.
- For a signed release build (Play Store or long-term personal install), use
  **Build → Generate Signed Bundle / APK** and create a keystore. Keep that
  keystore and its passwords safe and **out of git** — treat them like secrets.

## Notes specific to this app

- **Data lives on the device.** PGlite stores the database in the WebView's
  IndexedDB (`idb://student-panel`). Uninstalling the app or clearing its storage
  erases all students/scores — there is no server copy. Consider adding an
  export/backup step before relying on it for real data.
- **First launch runs migrations.** The same `server/src/db/migrations/*.sql`
  files run in-browser on first open to create the schema; this is a one-off and
  is idempotent (tracked in `schema_migrations`).
- **No CSP meta tag is set** in `client/index.html`, so the WebView's default
  policy applies and PGlite loads normally. If you later add a
  `Content-Security-Policy` meta tag, it must allow **`'unsafe-eval'`** (PGlite's
  bundled runtime uses direct `eval()` — the build prints `[EVAL]` warnings about
  this, which are harmless), plus `wasm-unsafe-eval` and `blob:`/`data:` workers,
  or PGlite will fail to start.
- **Absolute asset paths are fine.** Capacitor serves the bundle from the app
  origin root (`https://localhost` on Android), so Vite's default `base: '/'`
  resolves `/assets/*` correctly — no `base` change is needed.
- **On-device local API coverage.** `client/src/api/local.js` currently wires
  authentication, students, groups, field definitions, parameters, periods,
  evaluations, results, dashboard, preferences, saved views, audit, users, and
  roles to PGlite. Newer feature APIs (`teachers`, `schedule`, `sessions`,
  `tasks`, `alerts`, `cafe`, `accounting`, `agent`, `exports`) still call
  `api/http.js` and require either a reachable server or wiring their
  corresponding `server/src/core/services/*` handlers into `client/src/api/`.

## Verification status

Prepared but **not executed here** (no Android toolchain / device in this
environment): `npm install`, `npm run build`, `npm run cap:add:android`,
`cap sync`, and the native Android build. Run the sequence above on a machine
with Android Studio to produce and test the app.

