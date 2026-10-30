# Android companion app (Capacitor)

The mobile build is a **connected companion** for the same Student Panel
server. It bundles the React UI in an Android shell and talks to the configured
HTTPS API origin, so scheduling, scoring, cafe, accounting, audit, and the voice
agent panel have exactly the same data and permission enforcement as browsers.

It is not an offline copy of PostgreSQL. There is one authoritative database on
the server; the phone must be able to reach it.

## Requirements

- Node.js 20.19+ or 22.12+
- Android Studio / Android SDK
- JDK 21 (Android Studio's bundled JDK is suitable)
- A Student Panel server reachable from the phone over **HTTPS**

Plain HTTP should be limited to temporary emulator/LAN development. Production
credentials and session cookies must not travel over an untrusted network.

## Configure the server origin

From `client/`:

```bash
cp mobile.env.example .env.mobile.local
```

Edit `.env.mobile.local`:

```dotenv
VITE_API_BASE_URL=https://panel.example.com
```

The value is compiled into the mobile bundle. Capacitor's HTTP and Cookies
bridges are enabled in `capacitor.config.json`; the existing fetch wrapper still
uses the server's session cookie and double-submit CSRF token.

## Create and run Android

```bash
cd client
npm install
npm run cap:add:android       # first time only
npm run cap:sync              # mobile Vite build + cap sync
npm run cap:open:android      # open Android Studio
# or install on a connected emulator/device:
npm run cap:run:android
```

`client/android/` is generated and git-ignored. Re-run `cap:sync` whenever the
web client changes.

## Build an APK/AAB

Open Android Studio with `npm run cap:open:android`, then use:

- **Build → Build Bundle(s) / APK(s) → Build APK(s)** for a local debug APK.
- **Build → Generate Signed Bundle / APK** for release. Keep the keystore and
  passwords outside Git.

## Server-side deployment checklist

1. Serve the panel through HTTPS (see `deploy/Caddyfile.example`).
2. Set `HOST=127.0.0.1`, `TRUST_PROXY=1`, and
   `SESSION_COOKIE_SECURE=true` behind the reverse proxy. If the native HTTP
   bridge sends its WebView origin, also set
   `CSRF_ALLOWED_ORIGINS=https://localhost`.
3. Confirm the phone can open the same HTTPS URL in its browser.
4. Build the app with that exact URL in `.env.mobile.local`.

The ordinary web build is unchanged: when `VITE_API_BASE_URL` is absent,
requests stay relative and Vite/Express use the existing same-origin setup.
