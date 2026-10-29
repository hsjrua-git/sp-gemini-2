# Actual export workflow — 2026-10-29

Production API/SPA on `127.0.0.1:3300`, isolated PostgreSQL on port 55439,
Persian/RTL, disposable sample administrator, viewport 480 × 597.
Browser tab `tab_9bb695ea-acd8-44c2-bf05-c36bd07ca171`, generation 14.
Controls were activated through the existing DOM because of prior pointer-host
failures. This establishes application workflows, not pointer hit-testing.

## PNG refusal (A31)

After the actual `/export` page finished loading, disabled tabular data, added a
trend chart, selected Speed, and retained default PNG. The live chart SVG was
391 × 280; its legend SVG was 14 × 14. Export was enabled. Activating Export
settled with **Could not rasterize the chart SVG**; the button became enabled
again and the download list remained unchanged (only earlier XLSX/CSV controls).

Browser console event `a7531099-0d47-443f-aca6-236209b6af2b:446`:

> Loading the image 'blob:http://127.0.0.1:3300/ea95c506-173e-4d14-ac66-14ae2b247d5c'
> violates the following Content Security Policy directive: "img-src 'self' data:".
> The action has been blocked.

Fresh same-origin document GET confirmed the actual response CSP:
`default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'self';connect-src 'self';object-src 'none';base-uri 'self';form-action 'self';frame-ancestors 'none'`.

An isolated **browser capability control**, not an application fix, serialized the
same first live SVG into a `data:image/svg+xml` URL and loaded it via `Image`,
drew it on canvas and encoded PNG successfully: 14 × 14, `image/png`, 382 bytes.
The page CSP stayed intact. This distinguishes URL-policy refusal from missing
canvas/image support. No CSP or application files were changed.

## SVG content failure (A32)

Changed only image format to SVG, then activated Export. UI reported
`chart-1-trend.svg دریافت شد.` Download completed as `image/svg+xml`, **2250 bytes**,
file ID `file_958b752f-d88b-4472-bd55-99125bf3da98`.
Transferred bytes are retained as `chart-1-trend-original.svg`.

The actual file has width=14, height=14, viewBox `0 0 32 32`, aria-label
`سرعت (Speed) legend icon`, and one `recharts-legend-icon` path. It contains no
chart axes/data. Live DOM independently contained a separate 391 × 280 SVG with
the `.recharts-line` data and axis labels. The capture container's first SVG was
the legend. Download success alone therefore does not establish chart correctness.

## Selected-period content failure (A33)

Removed the chart, enabled scores, selected **Sample — Group A weekly**
(`b61de193-487f-4f26-bf3b-5b30c691b50b`), chose explicit periods, then checked only
period **1** (53 answered). Period **2** (41 answered) stayed unchecked.
With no periods checked Export was disabled; checking 1 enabled it.

Settled preview still said **30 students · 6 parameters · 2 periods**.
Actual POST `/api/export/cube` request `a7531099-0d47-443f-aca6-236209b6af2b:452`
returned 200 with request body containing **only assignmentId**, no period list.
All-calendar request `:451` had the same body. Response-body capture was bounded
and truncated; no complete response assertion is based on that truncated body.

Activated Export and downloaded `scores.csv`, **2991 bytes**, completed file ID
`file_7fa35a79-39f4-4b56-a3c2-4cc1a87ceac5`.
Retained `selected-period-1-original.csv` parses as **30 data rows** covering both
`Sample — Group A weekly · 1` and `Sample — Group A weekly · 2`.
The independent real API control in `export-period-control-02.{txt,json}` sends
`periods:[1]` and receives **210 cells, all periodSeq=1**. The API's period metadata
still lists both periods; metadata scope is recorded separately from score scope.

## Chart period and label failures (A34/A35)

Added a distribution chart with Speed. Its period selector initially showed 2,
then explicitly selected 1. After both state changes the plot had **zero nonzero
bar paths**, showing only bands 0–20 … 80–100 and y-axis 0 … 4 despite the
downloaded scores for both periods. Component controls independently prove that
passing an explicit period key directly to DistributionChart renders a data bar.

Changed the chart to heatmap, axis=period: the two visible period headers both
read **Pb61de1…**. Changed axis=parameter with period 1 still selected: its caption
named UUID-key **…:2**, and Sample Student 01's Speed cell showed **44**, the period-2
value. The retained CSV gives the same student's period-1 Speed as **64**.

Earlier live trend plot axes repeated **shared.periodKey**, an absent translation
key, instead of naming its assignment-periods. Both languages define
`shared.periodLabel`, not `shared.periodKey`. Component label tests supplement
the actual Persian browser evidence.

## Probe limits and corrections

- Initial browser-evaluate script used a top-level `return`, which this host
  rejects; corrected to an expression. No mutation occurred in that failed call.
- Initial `export-ui` run used a middle dot where the translation uses an em dash,
  and strict XML parsing hit jsdom's duplicate-xmlns serialization behavior.
  The corrected run inspects SVG structure using HTML parsing and retains the
  Chromium artifact separately. Neither harness failure is a product finding.
- Initial API control assumed period metadata was narrowed along with cells;
  inspection showed only cells are narrowed. Corrected run asserts the actual
  cell filter before checking the original downloaded artifact. Original outputs
  are preserved under their original stems.
- Browser controls alter page-local export configuration only. No score, finance,
  schedule or student records were changed by these export workflows.
