# A22 live CSV retry — 2026-10-30 local time

Rebuilt production preview (`build-preview.txt`) at `127.0.0.1:5300`, isolated
API/database. Reloaded bundle; Administrator, Persian/RTL, **1233×887** viewport.
Uploaded retained `browser-scores.csv` through the actual file-input tool.
The fixture group/current session were selected, and automatic code/quality/
quantity mapping selected columns 1/2/3. Check and Import buttons were focused
via DOM and activated with native Enter; no direct API submission replaced UI.

- **21:09:37Z:** preview shows one changed and one new score, zero problems.
  Student One displays **6 → 0** quality and **1 → 5** quantity. Student Two
  displays **—** quality and **7 new** quantity. Import-two button is enabled.
- Preview request `a7531099-0d47-443f-aca6-236209b6af2b:720` returns **200** with
  nested from/to objects, statuses change/new, counts new=1/change=1/problems=0.
- Confirmation request `…:721` returns **200 / changed:2**. Payload contains the
  same two entries, `source:"import"`, and no dryRun flag. UI shows the completed
  step and translated “Saved. 2 scores changed.” No error-boundary screen,
  `[object Object]`, or console error occurs.
- `browser-import-readback.txt` independently confirms One **0/5**, Two **null/7**;
  the separate individual score and locked group fixture retain their values.
- Cleanup and independent verification pass: viewer role restored, temporary
  blind role absent, **zero** fixture evaluations, all **three sessions/two
  assignments/one parameter/one group/two students** inactive. Evidence retained
  in `browser-fixture-cleanup.*` and `browser-cleanup-verified.*`.

One initial navigation used `/import/scores`; source lookup corrected the route
to `/evaluate/import` before uploading. This was a harness navigation mistake.
These live checks cover sighted changed/new/blank/zero previews and confirmation;
the seven permanent component cases additionally cover blind, locked and
unchanged previews and confirmation availability.
