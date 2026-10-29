# Native keyboard regression — A15 extension

2026-10-29, baseline `a4d81f0`, isolated production `/schedule`, Persian/RTL,
**480 × 597**, tab `tab_9bb695ea-acd8-44c2-bf05-c36bd07ca171`, generation 16.
The continuation-10 observations were repeated with the retained executable
Code Mode recipe `../checks/menu-focus.browser.js`: **4 fail / 2 pass**.
This is the already-recorded A15, not a new finding A37.

Native `browser.press` sent Enter, Tab, Shift+Tab and Escape. DOM `focus()` only
established the initial toggle and first/last boundary positions. Each observation
waited one animation frame; no synthetic key events, jsdom layout/focus mocks,
forced focus-result overrides or application changes were used.

| Check | Actual focused element / state | Result |
|---|---|---|
| Enter on toggle opens and focuses first visible menu control | Open=true; focus remains `button.nav-toggle`, outside sidebar | FAIL |
| Tab after opening stays inside menu | `select#assignment-teacher` behind open overlay | FAIL |
| Shift+Tab from visible `button.panel-back` wraps to last | `a.skip-link`, outside sidebar | FAIL |
| Tab from last `button.account-signout` wraps to first | Remains on `button.account-signout` | FAIL |
| Escape closes and restores focus | Open=false; focus=`button.nav-toggle` | PASS |
| Closed sidebar becomes inert | `aside.inert === true` | PASS |

Every observation reported `.rail-toggle` as `display:none`; prior native
inspection also established zero client rectangles. `Layout.jsx:80-85` selects
it as first focus target without visibility filtering. `Layout.jsx:99-104`
then compares/wraps to that hidden control; `index.css:1623-1627` hides it below
880px. Reverse traversal therefore misses its boundary; forward wrap prevents
default navigation while unsuccessfully focusing the hidden control.

The runner returned normally with explicit failed assertions, not a process exit
code. The menu was closed by its `finally` cleanup and focus returned to the
toggle. No database mutation was performed. Desktop layout remains unexecuted.
