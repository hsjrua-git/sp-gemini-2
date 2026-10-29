# Preferences and route-focus controls

Isolated production SPA, baseline `a4d81f0`, authenticated disposable sample-admin.
Tab `tab_9bb695ea-acd8-44c2-bf05-c36bd07ca171`, generations 17–18,
**480×597**. Native `browser.press` sends Space/Enter. DOM `focus()` establishes
the selected radio or link; no synthetic change/click/key events or app edits.

## Preferences — PASS with restoration

1. Actual `/preferences` initially shows Persian/RTL, dark theme. Independent
   GET `/api/preferences` returns 200 and language=`fa`, theme=`dark`.
2. Focus English radio and send native Space. UI reports Saved, document becomes
   `lang=en`, `dir=ltr`, heading/title translate. Independent GET 200 confirms
   language=`en`; all other preferences remain unchanged.
3. Focus Light radio and send Space. Saved status, applied `data-theme=light`,
   independent GET 200 confirms theme=`light`.
4. Reload by navigating to the same URL. English and Light radios remain checked,
   HTML remains English/LTR/light; horizontal overflow **0px**.
5. Return via native navigation, activate Dark then فارسی radios with Space.
   Translated saved status and GET 200 confirm the **entire original preference
   object restored**, including the nested dashboard settings. Final HTML is
   `fa`/`rtl`/`dark`. No reset-to-defaults mutation was used.

## Native route transitions — two passing instrumented controls

Open menu with Enter, focus the destination link, then send native Enter.
For Preferences → Schedule, first activate the Evaluation panel with Enter.
Both Schedule → Preferences and Preferences → Schedule:

- Rendered destination heading and document title agree with the route.
- Drawer closes and sidebar becomes inert.
- `focusin` records the actual new **H1**, after the content host is revealed.
- Schedule overflow is **0px**; `prefers-reduced-motion` is false.

Read-only focusin/focusout and host-style MutationObserver instrumentation records:

| Transition | Host hidden (performance ms) | Host revealed | H1 focusin |
|---|---:|---:|---:|
| Schedule → Preferences | 141278 | 141490 | 141500 |
| Preferences → Schedule | 156481 | 156743 | 156762 |

Listeners/observer were removed after the controls. They observed native events
and did not call focus or modify the transition after Enter.

## Inconclusive preliminary observations

- An initial probe assumed `/schedule` was in the top-level menu while Preferences
  was active. It is inside the Evaluation panel. The missing-selector exception
  is a probe mistake, not a product finding.
- The initial wait for text `Schedule` matched the menu link before the destination
  committed. A later uninstrumented observation showed BODY focus, with no captured
  timing/cause. The two instrumented controls above pass; that first observation
  remains **inconclusive**, not A37 or an asserted route-focus defect.
- These controls do not repair or negate A15's independently reproduced menu
  opening/containment failures. No desktop or reduced-motion assurance is claimed.
