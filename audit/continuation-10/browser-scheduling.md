# Actual scheduling refusals — 2026-10-29

Production SPA/API on isolated `127.0.0.1:3300`, database port 55439;
Persian/RTL, sample administrator, browser tab
`tab_9bb695ea-acd8-44c2-bf05-c36bd07ca171`, generations 15–16.
DOM activation was used (previous pointer-host limitation remains).

## Session quick Cancel silently fails (A36)

Session `SAMPLE-A1-008`, ID `53fe87cd-effd-46bd-af11-5b8efdbc9a39`,
planned/effective date `2026-10-22`, period 2, has **16 evaluations** (real GET 200).
Before action, canceledAt/archivedAt/movedTo/note were null.
Activated the row's quick Cancel button (Persian `انصراف`).

- Request `a7531099-0d47-443f-aca6-236209b6af2b:482`: actual PATCH,
  body `{"canceled":true}`, completed **409**.
- Exact response: `{"error":"Archive or remove the active evaluation cells before canceling this session.","code":"SESSIONS_HAS_EVALUATIONS"}`.
- After settlement the row remained active and its button enabled. There were
  **zero** `main .error` / `main [role=alert]` elements or explanatory text.
- Control: opened the same row's Edit form, checked Canceled, saved.
  Request `:491` returned the same **409**. This time the form displayed
  `پیش از لغو جلسه، سلول‌های ارزشیابی فعال آن را حذف یا بایگانی کنید.`
  This proves localization and form-level error presentation work.

## Session archive/unarchive control and cleanup

Archive was also exercised, initially expecting the cancellation guard might
apply. It **succeeded**: request `:484`, body `{"archived":true}`, **200**, row
disappeared from the default list and its period membership detached. That is a
passing archive workflow, not a refused-operation finding.

Enabled Include archived, located the same row, and activated Unarchive:
request `:487`, body `{"archived":false}`, **200**. Fresh API read restored **all
session response fields exactly**, including original period ID
`d65778e1-4c9c-47cd-b28f-bff6f0e9ea3d` and seq=2. Evaluations remained **16**.
The session's update/audit history legitimately records archive and restoration;
no claim is made that those timestamps were unchanged.

## Assignment Restore silently fails (A36)

On `/schedule`, enabled Include archived and located the already-cleaned fixture
`WA229LDS` / `Audit CSV preservation 5e7c7db2-d`, assignment ID
`8a8934cf-3ded-4bc5-b73a-9d94f597c40b`. Its group
`5d276a27-afe2-4fa1-bae5-cde2c9151a2d` is archived (independent GETs).
Activated Restore.

- Request `a7531099-0d47-443f-aca6-236209b6af2b:525`: PATCH body
  `{"archived":false}`, completed **400**.
- Exact response: `{"error":"Choose an active group.","code":"ASSIGNMENTS_GROUP_INACTIVE"}`.
- Settled row remained archived, Restore enabled, and **zero** error/alert
  elements or explanatory text. No fixture restoration occurred.

## Harness/probe corrections

- Initial wait used `جلسه‌ها` instead of the actual title `جلسات` and timed out;
  the page was loaded. This is not a product failure.
- A post-archive script assumed the row remained in the default list and threw
  before executing Edit. Inspection showed successful archive; Include archived
  exposed the row and Unarchive restored it as documented above.
- One wait matched a global sidebar word while the Edit request was pending.
  The subsequent exact-error wait established the settled control; pending
  absence was not counted as a failure.
- Teachers/interval/template archive/restore and alert-resolution error-display
  omissions remain source-only adjacent paths, not executed refusals in A36.
- Initial component probes (`scheduling-errors` and `-02`) exposed harness mistakes:
  English Canceled matched both a filter and the edit field; the first probe also
  read the DOM immediately after cache settlement. Later inspection established
  the mock omitted the HTTP wrapper's top-level `error.code`, so the Edit control
  rendered its fallback English message. Corrected `-03` scopes the edit field,
  waits for rendered error text, and matches the actual wrapper error shape.
  These control failures are excluded from product findings; originals retained.
