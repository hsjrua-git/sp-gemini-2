# Browser workflow evidence — 2026-10-29

Baseline `a4d81f0`, isolated production API/SPA at `http://127.0.0.1:3300`.
In-app Chromium, observed viewport **454 × 612**, Persian/RTL. No viewport
emulation or desktop-layout claim. Tab `tab_9bb695ea-acd8-44c2-bf05-c36bd07ca171`.

## Export workbook — PASS

1. Open `/export`; application redirects to `/login`.
2. Fill the isolated sample-admin fixture and submit the actual login form.
3. Export page restores, showing 30 students, 6 parameters and 13 periods.
4. In the UI select Excel (`xlsx`), keep Scores selected and check Changes.
5. Click «گرفتن خروجی». UI reports `export.xlsx`; browser download completed:
   13,829 bytes, spreadsheet MIME type.
6. Transfer the completed download using `browser.files.get`; retain bytes in
   `audit/continuation-01/ui-export.xlsx`.
7. Independently validate ZIP CRCs, XML, relationship targets, style references,
   absence of formulas and known preview cell values with Python stdlib.
   See `ui-workbook-validation.{txt,json}`: **168 Scores rows / 106 Changes rows**.

The initial wait for uppercase `XLSX` timed out because the option text is
`Excel (.xlsx…)`; a fresh snapshot showed the loaded page. This was an incorrect
wait target, not a product failure. Overall document overflow measured **0**.

The actual source `buildWorkbookBlob` was also called with two synthetic sheets;
the independent validator checks Unicode/XML escaping/newlines, boolean and
numeric types, maximum safe integer, blank/nonfinite cells and formula-prefixed
text. `workbook-generation.{txt,json}` passes. Neither check opens Excel/LibreOffice.

## Mobile navigation keyboard — FAIL (A15)

On the same `/export` page:

1. With menu closed, `.sidebar.inert === true`.
2. Click the real `.nav-toggle` through the browser click tool.
3. Evaluate focus and styles after opening:

```json
{"open":true,"firstDisplay":"none","focusInside":false,
 "focusedElement":"button.nav-toggle[aria-expanded=true]"}
```

`firstDisplay` is `getComputedStyle(document.querySelector('.rail-toggle')).display`.
`focusInside` is `.sidebar.contains(document.activeElement)`.

4. Send a real `Tab` using `browser.press`, not a synthetic keyboard event.

```json
{"focusInside":false,"focusedElement":"input[type=radio][name=student-mode]"}
```

Focus moves into the page behind the still-open navigation overlay.
5. Send `Escape`:

```json
{"open":false,"inert":true,"focusClass":"nav-toggle"}
```

Escape closes/restores focus correctly; opening and forward tab containment fail.
Source: `client/src/components/Layout.jsx:80-105` includes hidden `.rail-toggle`
as its first focusable item. `client/src/index.css:1623-1627` hides it on mobile.

## Console

Only captured error: initial signed-out `GET /api/auth/me` 401, expected.
No other error-level messages; console capture reported no truncation/drops.
