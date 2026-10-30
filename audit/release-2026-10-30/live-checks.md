# Release browser checks — 2026-10-30

Source: `4d0c87d`, production-built SPA, normal `npm start` at
`http://localhost:3000`, configured `sp_gemini_1_audit` database after migrations
036/037. Authenticated as `sample-admin`. Chromium, actual viewport **1233×887**,
Persian/RTL. This is an operator record of live browser-tool observations.

## Route sweep

Every row below had a rendered page heading, **zero visible error alerts, zero
document overflow, zero captured console errors, and zero failed/HTTP ≥400 API
requests**. Each page was directly navigated, then observed until its loading
indicators disappeared and its text settled. API counts include authentication
and preference reads; this measures route rendering, not every possible action.

| Route | API requests |
| --- | ---: |
| `/dashboard` | 7 |
| `/students` | 5 |
| `/students/198a96c0-cf47-44e9-b1b9-bbe1722d59cf` | 11 |
| `/teachers` | 3 |
| `/schedule` | 7 |
| `/sessions` | 9 |
| `/task-templates` | 3 |
| `/evaluate` | 12 |
| `/parameters` | 3 |
| `/results` | 7 |
| `/export` | 7 |
| `/groups` | 3 |
| `/fields` | 3 |
| `/students/import` | 2 |
| `/evaluate/import` | 7 |
| `/cafe` | 4 |
| `/cafe/products` | 4 |
| `/cafe/purchases` | 5 |
| `/cafe/inventory` | 4 |
| `/cafe/reports` | 3 |
| `/accounting/journal` | 4 |
| `/accounting/accounts` | 4 |
| `/accounting/periods` | 4 |
| `/accounting/reports` | 4 |
| `/agent` | 3 |
| `/agent/transcripts` | 3 |
| `/users` | 4 |
| `/roles` | 4 |
| `/preferences` | 3 |
| `/change-password` | 2 |
| `/audit` | 3 |
| `/release-route-not-found` | 2 |

Login was checked separately: successful HTTP 200 sign-in and redirect to the
Persian Dashboard. The initial signed-out `/api/auth/me` 401 was expected.
`/` also redirected to `/dashboard`. A subsequent Dashboard observation found
the 520×460 canvas and no document overflow; it is not a new cold-start timing.

## Repaired error paths and interactions

- On the restored **unmigrated** clone at port 3303, opening `/task-templates`
  displayed the new Persian upgrade instructions (`stale-schema-fa.jpeg`).
  Health and API returned `DATABASE_MIGRATIONS_PENDING`, HTTP 503, rather than
  falsely healthy status followed by task-query HTTP 500s.
- After upgrade, the normal `/task-templates` page displayed both existing
  templates and their empty default checklists (`configured-task-templates.jpeg`).
  Opened the first template's editor and canceled successfully.
- In normal Evaluate, selected `SAMPLE-A3`, session `SAMPLE-A3-001`
  (`737ba846-6344-4f85-b7a8-f0e678920952`), and expanded current tasks. The existing
  **Sample · Completed warm-up** task displayed its completed state, student and
  original timestamp, with no error (`configured-task-review.jpeg`).
- Current/previous task reads and target requests completed successfully. An
  empty previous-session state was correctly shown for the first session.
- The fresh isolated workflow smoke separately exercised confirmed generation,
  multi-target rollback, independent checklist copies, concurrent progress,
  viewer denial, and scoped dual-dimension Results/Export equality.

Some native browser-tool clicks did not dispatch a login request; submitting the
same form with DOM `requestSubmit()` succeeded. Text waits expecting English
timed out because the stored account preference restored Persian. Neither is
counted as an application defect. Later selector, disclosure and editor clicks
worked through the ordinary browser tools.

Actual mobile/device layouts, real hidden-tab suspension, physical audio/model
providers and cross-browser/screen-reader behavior were not reverified here.
