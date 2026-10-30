# Student workflow live-check record — 2026-10-30

Implementation: `1ab6179`, baseline `2338494`, local `audit-fixes`.
Production-built SPA/API: `http://localhost:3302`, disposable PostgreSQL clone
`student_panel_workflow_checks` on port 55439. Fixture before probes: 30 complete
students, 4 groups, 6 parameters, 3 teachers, 5 assignments, 71 sessions,
13 answered periods, 573 stored evaluation cells and 6 tasks.

This is the operator's record of browser-tool observations during implementation.
Saved screenshots/downloads/traces are listed in `captured-files.json`; not every
interaction has a separate raw transcript. Commands and their numeric results
are indexed in [the implementation report](../../docs/student-workflows-2026-10-30.md).

## Actual browser interactions and API readbacks

| Area | Observed result |
| --- | --- |
| Session generation | Duplicate assignment refused. Created schedules `DGBW7M73` (Sample Student 02) and `U5CK6BPT` (Sample Group A). Confirmation created exactly the eight previewed sessions. |
| Shamsi calendar | Navigation, month/year selection, bounds and closing worked. Invalid Jalali drafts stayed visible and blocked submission. Keyboard navigation/focus restoration also have component regression coverage. |
| Task snapshots | Independent assigned copies retained their own progress/notes/timestamps; Evaluation displayed previous-session review. See `evaluation-checklists.jpeg`. |
| Dedicated template page | Created `Dedicated page probe`, edited its checklist from two to three items, archived/restored it, then selected it on Sessions and received `Created 1 tasks.` See `task-templates.jpeg`. |
| Template authorization | Viewer had no template navigation link; direct `/task-templates` navigation redirected to Dashboard. Authenticated template POST returned **403**. |
| Groups, English | Four visible rows collapsed to one. Search `Sample Lab` recovered the child with `Sample School — مدرسه / Sample Group A` context; zero document overflow. |
| Parameters, Persian/RTL | Six cards collapsed to four. Search `استقامت` recovered one child with `سرعت (Speed)` parent context; `lang=fa`, `dir=rtl`, zero overflow. |
| Hierarchy selection | Expand/collapse, branch selection/counts, selected-only filtering and summaries were exercised. Retained `hierarchy-picker.jpeg`; component tests cover interactions. |
| Dashboard parameters/orbits | Empty and one-parameter selections persisted. All-parameter reset worked. One/four/six-orbit scenes rendered; pages moved from 1–6 to 7–12 out of 68 scoped orbits. One-period scope also rendered correctly. |
| Parameter details | Clicking the orbit legend loaded the chart bundle on demand (resource count 0→1), opened two charts and displayed quality axes 0/25/50/75/100. No positive document overflow. |
| Student Detail | Sample Student 03 (`PS7VR5MB`) displayed eight sessions from two periods of `SAMPLE-A1`, separate dimension sections and two parameter charts. Downloaded history CSV contained those exact eight dates and both dimensions. |
| Exports | Downloaded CSV/SVG, XLSX/SVG, JSON and JSON/PNG bundles. JSON contains 15 students, six parameters, two periods and previous values; both PNGs are 1120×840. |
| Numeric filter | `Speed equals 64` produced 12 students for quality and zero for quantity, independently matching retained JSON values. |
| Legacy/empty Export scope | Sequence 1 resolved to one exact period. Sequence 999 showed the unavailable-period alert and disabled export. A selected assignment with zero answered periods also disabled export. |
| Final Export correction | Unavailable sequence 999 initially left `Loading data…` visible. Final build: alert present, export disabled, `loading: false`. |
| Locked override | Group Speed in `SAMPLE-A1-001`: Save disabled with no reason; valid inline reason enabled save. Saved **57→58**, verified readback, then restored **58→57** with a second reason. Audit readback contained the restoration reason. |

Stable probe references:

- Assignment: `9603df83-c11b-4291-be05-393dcb68f9f6` (`SAMPLE-A1`).
- Speed: `cd24746c-b362-4c50-9905-ee6d6511d36b`.
- Locked session: `5a432c76-674f-4b24-a227-933fe2bb2b9a` (`SAMPLE-A1-001`).
- Student: `0ebff6d0-3d0f-45ff-8681-4ef8abc863ef` (`PS7VR5MB`).
- Dedicated template: `093d5964-23fe-4d47-a647-341e2e86d06f`.

### Route sweep

At 1233×887, 30 swept routes rendered headings with **zero document overflow,
error boundaries, alerts or captured console errors**. Dashboard, Student Detail
and login were also inspected separately; `/` redirected to `/dashboard`.
Targeted mutation/empty/error states above were checked separately from the
settled-route sweep. This is route-rendering coverage, not proof of every action
on every page.

## Actual offscreen behavior

An open parameter picker moved the canvas below the viewport. The scene's
`data-render-active` changed to false; the renderer frame counter stayed at
**1220** on subsequent observations. Closing the picker, scrolling to the scene
and resizing its container resumed rendering; a later counter was **1382**.
The resized camera position and world matrix agreed. This verifies offscreen
suspension/resumption, not a measured process-wide CPU percentage.

## Synthetic visibility check and harness limitation

Switching the Review tab to `about:blank` did **not** report a hidden original
document (`document.hidden` stayed false). Waiting for animation frames on the
blank tab timed out. No real hidden-tab pass is claimed.

A separate injected `document.hidden=true` plus `visibilitychange` changed
`data-render-active` to false at frame **1658**. Restoring the native property and
dispatching the event reactivated the loop. This exercises the handler only.
The injected property was removed after the check.

## Constrained-width probes (not device emulation)

- **304 px canvas:** one- and six-orbit scenes remained framed. One-orbit camera
  z changed from 4.337789 to 6.287224 and matched its matrix. Screenshots:
  `one-orbit-narrow-container.jpeg`, `six-orbits-narrow-container.jpeg`.
- **352 px Export main container:** main `clientWidth/scrollWidth` = **352/352**;
  configuration and output **304/304** each. The grid was forced to one column
  for this probe; temporary styles were removed afterwards.
- `window.resizeTo` did not change the actual browser viewport. These results
  do not establish phone breakpoints, touch behavior or native-device layout.

## Comparable final cold captures

Fresh origins `workflow-cold-a.localhost:3302` and
`workflow-cold-b.localhost:3302` authenticated before navigating to Dashboard.
Both used the final build, 1233×887 viewport, all groups/assignments/periods,
quality, 3D mode, automatic rotation and all parameters. The first cold tab was
moved to `/api/health` before the second capture.

| Measurement | Run A | Run B |
| --- | ---: | ---: |
| Observer attached, ms from navigation time origin | 931.5 | 860.0 |
| Canvas DOM observed, ms | 3604.3 | 3746.4 |
| Observed 2D `.cohort-orbit` states | 0 | 0 |
| Initial `chartTheme` resource | Absent | Absent |
| Trace long tasks | 9 | 8 |
| Trace long-task blocking, ms | 912.085 | 867.314 |

Both recordings completed. Canvas insertion is not first rendered WebGL paint;
observer coverage begins at the times above. Blocking values are trace-analysis
metrics, not Web Vitals. `earlier-*-trace.json.gz` and
`before-lazy-charts-trace.json.gz` preserve earlier conditions and are not a
controlled before/after performance comparison. `before-camera-correction.jpeg`
retains the blank-canvas failure; later orbit screenshots show the corrected
scene. No reliable startup speedup percentage or total CPU saving is asserted.

## Evidence and closing checks

- `captured-files.json`: byte counts/SHA-256 for 26 copied captures/logs.
- `.gitattributes` preserves the history CSV's original BOM/CRLF bytes and
  recognizes CRLF during whitespace checks; the downloaded file was not rewritten.
- `artifact-verification.{json,txt}`: all hashes, exact history dates,
  JSON/dimension/filter values, PNG dimensions and XLSX/SVG structure passed.
- `agent-tests.{json,txt}`: 37 passing tests, exit 0.
- `preservation.{json,txt}`: checked after `1ab6179`; 629 non-secret inventory
  files, 295 original evidence files, no missing/unexplained changes. Supplied
  handoffs and `partly-schema/` remain untracked.
- `supplied-preservation.{json,txt}`: all six supplied handoff/schema hashes
  match the previous Stage 2 closing receipt.
- `stop-verification-api.{json,txt}`: the verified workflow API PID was stopped
  with SIGTERM; port 3302 has no listener.

The disposable clone intentionally retains workflow probes for inspection.
The original locked score was restored. No original audit database was mutated
for these checks. The temporary verification API is stopped at local closure;
the isolated databases remain available for a later review session.
