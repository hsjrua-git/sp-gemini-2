# Scoring browser checks — Stage 1, 2026-10-29

Unmodified production bundle/API at `127.0.0.1:3300`, existing isolated sample
database. These observations are separate from the earlier 454px route sweep.
Current measured viewport: **528 × 612**, Persian/RTL.

## Individual-assignment grid fails to render

1. With the existing Administrator session, navigated to `/evaluate`.
2. Default `SAMPLE-A1` group assignment rendered **16** grid rows (group + 15
   members), six parameter columns, and the selected 2026-10-29 session.
3. Used the actual assignment dropdown to select `SAMPLE-I1`, “Sample —
   Individual coaching” (`e6c6fff5-2ecc-41fe-9b27-cd866ab17790`).
4. At **18:08:38.615Z**, the session selector had **10** options and selected
   `5daccef9-0e2f-473f-83a8-f65f0898d5e5`; the grid had **0** rows and the page
   displayed `در حال بارگذاری…` (Loading). Save/discard were disabled.
5. Captured network requests show sessions and evaluations both completed
   **200** in 129.47ms and 130.705ms respectively. Their request IDs were
   `a7531099-0d47-443f-aca6-236209b6af2b:78` and `:79`; session fetch started at
   18:08:23.680Z. This is a settled-query failure, not a cold lazy-chunk delay.

Source: `EvaluatePage.jsx:102-106` disables group-member loading for individual
assignments, but `:348` includes its `isPending` in the unconditional loading
gate and `:467` suppresses the grid. A disabled query without cache is pending
and idle in Query v5. The analogous saved-query gate is also disabled for blind
entry (`:93-97`) and needs its own executed regression.

Context7 lookup failed with ECONNRESET. Official fallback documentation was read:
https://tanstack.com/query/v5/docs/framework/react/guides/disabling-queries
(disabled/no-cache = pending + idle; `isLoading = isPending && isFetching`).

No score writes were made in this check.

## CSV preview crashes the application (A22)

1. Navigated to `/evaluate/import`, selected the sample group session
   `393ec807-1194-4e60-8b69-386594324b0e`, and uploaded the actual retained
   `score-preview.csv` using the file input. The code matched member
   `13145f64-97c0-4890-b3e1-2eee9a386c2d`; parameter
   `7797ceff-cb5d-4e50-b8da-4783a6d3b110` was mapped to both dimensions.
2. An initial browser click failed with `UnknownVizError`. Inspection showed
   no PUT and the unchanged page; that tool failure is not the product finding.
   Scrolled and clicked the visible Check file button using a fresh reference.
3. The real PUT `/api/evaluations/bulk` at **18:11:07.052Z** completed HTTP
   **200** in **102.222 ms**, request ID
   `a7531099-0d47-443f-aca6-236209b6af2b:115`. Request body:

   ```json
   {"sessionId":"393ec807-1194-4e60-8b69-386594324b0e","entries":[{"membershipId":"13145f64-97c0-4890-b3e1-2eee9a386c2d","parameterId":"7797ceff-cb5d-4e50-b8da-4783a6d3b110","selected":true,"qualityValue":77,"quantityValue":66}],"dryRun":true}
   ```

   The returned cell was `status:"new"`, `from:null`, with
   `to:{selected:true,qualityValue:77,quantityValue:66,qualityComment:null,quantityComment:null}`;
   `problems:[]` and `counts.new:1`.
4. At **18:11:07.212Z** the browser logged **Minified React error #31** naming
   those five object keys. The application rendered `مشکلی پیش آمد` (Something
   went wrong) and only Reload remained. Reinspection at 18:15 UTC confirmed the
   boundary and retained network/console evidence.
5. Actual evaluation GETs before/after returned `evaluations:[]`. This was a
   dry run; no imported scores were committed.

Source: `ImportScoresPage.jsx:51-117` renders full `info.from`/`info.to` objects
as React children, while `server/src/lib/scorePreview.js:24-31,67-74` returns
whole-cell before/after objects. Dimension rendering must select scalar fields.

## Component regressions, executed separately

`scoring-components.{txt,json}` records the first execution (18:14:13–18:14:22Z,
exit 1): **1 pass / 3 failures**. The real Query/page/grid control permits
typing 77 for a sighted group. Individual assignment and blind group entry both
have no usable grid after all enabled queries succeed and `isFetching()===0`;
the irrelevant disabled query remains pending/idle. The CSV case executes the
real parser, mapping and server preview builder and reproduces the same object
child error in `CellView`. Mocked resource APIs do not establish live HTTP blind
entry or successful saves. No harness/assertion correction was needed.
