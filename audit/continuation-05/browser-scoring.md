# Browser scoring continuation — 2026-10-29

Real production SPA/API at `127.0.0.1:3300`, isolated database on port 55439.
Viewport **480 × 597**, Persian/RTL. Fixture `Audit UI d92452d082` created by
`checks/browser-scoring-fixture.mjs`; IDs and setup outputs are retained nearby.

## Sighted save — PASS

The actual group-row checkbox, quality/quantity inputs, comment control and Save
button were used. Entered quality **7**, quantity **6**, quality comment
`یادداشت آزمون رابط`. Success banner appeared and Save/Discard became disabled.

Captured browser request `a7531099-0d47-443f-aca6-236209b6af2b:148`:

- `PUT /api/evaluations/bulk`, started `2026-10-29T18:32:27.187Z`.
- HTTP **200**, duration **207.687 ms**.
- Payload: session `a5cfa5f4-8e24-479c-90d9-a366cb69b45b`, membership null,
  parameter `ce60e3c7-4e51-46e2-8dcc-f7b8051ab09e`, selected true, quality 7,
  quantity 6, quality comment as above, quantity comment null.
- Response: same session ID, **`changed:1`**.
- Independent authenticated readback: `browser-score-readback.{txt,json}`;
  same values/comment and `updatedAt: 2026-10-29T18:32:27.304Z`.

## Localized digits — observed rejection

Initially typing Persian **`۷` / `۶`** left Save disabled and rendered English
`Enter a whole number.` errors in the Persian interface. Replacing only the
digits with ASCII **7 / 6** enabled the successful save above. No localized-digit
PUT occurred. `client/src/lib/cells.js:24-32` validates ASCII digits without the
existing `toLatinDigits` normalization. Supplemental contract regression and
classification are recorded separately when executed.

## Locked override — browser harness limitation

Selected locked session `bf597afe-451b-48ea-9e4f-cd412be15adc` (stored **2 / 3**,
comment `Audit locked fixture`). Changed quality to **8**; UI correctly labelled
one locked change. Clicking Save at approximately **18:34:04Z** produced:

```text
Error: prompt() is not supported.
at ue (http://127.0.0.1:3300/assets/EvaluatePage-DWsMXlCi.js:1:8727)
```

Browser dialog inspection returned null. Captured evaluation requests contain
only the earlier successful PUT and the locked session GET: **no override PUT**.
This does not establish a product override failure; the native prompt is
unsupported by this browser host. Actual HTTP override is covered separately by
the passing `continuation-01/scoring-workflow` probe.

On resumption the draft was still 8 / 3. Clicking the actual **Discard** button
restored **2 / 3** and disabled Save/Discard. Thus the unsaved draft was discarded
before changing authentication or cleaning the fixture.

An initial checkbox tool call returned `UnknownVizError` while scrolling, with
no changed checkbox state; a fresh-snapshot retry succeeded. This tool artifact
is excluded from product findings.

## Blind entry — A21 reproduced live; read-denial controls pass

`browser-fixture-blind.{txt,json}` assigned the synthetic blind role to the
disposable `sample-viewer`, then the actual login form was used. Fresh
`/api/auth/me` confirms exactly `parameters.view`, `scores.enter`, `students.view`.
Fresh navigation to `/evaluate` selected the fixture and its current session.

At **18:38:12.931Z**, assignments, parameters, sessions and memberships requests
were all completed (HTTP **304**, valid browser cache revalidation). Both session
options were populated, but the body still ended in `در حال بارگذاری…`, with
**zero table rows and zero inputs**. No evaluation-read request was issued by
the page; no pending requests, error boundary, overflow or console errors were
present. The same loader persisted at **18:38:36.687Z**. This establishes the
blind branch of A21 beyond the earlier component-only reproduction.

Explicit browser fetch controls, performed after capturing page requests:

- `GET /api/evaluations?sessionId=<current fixture>` → **403 AUTH_FORBIDDEN**.
- `GET /api/results?assignmentId=<fixture>&periodSeq=1` → **403 AUTH_FORBIDDEN**.
- `GET /api/export/cube?assignmentId=<fixture>` → **403 AUTH_FORBIDDEN**.
- The saved Persian quality comment was absent from the DOM.

These denials do not refute the separately reproduced A14 write-response oracle.
Blind browser entry/save cannot be exercised until A21 is fixed.

Login's first click produced another `UnknownVizError`; inspection confirmed the
login form remained, and a fresh-reference click returned HTTP 200. A subsequent
wait incorrectly targeted an aria-label as visible text and timed out after the
successful navigation to Students. Neither harness event is a product finding.

## Cleanup — independently verified

`browser-fixture-precleanup` re-read both sessions with unchanged values and
timestamps. `browser-fixture-cleanup` completed normally. The separate SELECT-only
`browser-fixture-cleanup-verified` check passes: original viewer role restored,
blind role absent, **zero** remaining evaluation rows for the two sessions;
two sessions, one assignment, one parameter, one group and two students are
inactive. Audit history is retained. Runtime recovery state is marked cleaned.
