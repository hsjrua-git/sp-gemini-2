# A31–A35 production-build export retries

Tab `tab_9bb695ea-acd8-44c2-bf05-c36bd07ca171`, generation **29**, Persian,
**528×887**, `http://127.0.0.1:5300/export`. Real controls and downloads; read-only
sample reporting data. Request `a7531099-0d47-443f-aca6-236209b6af2b:901` has:

```
default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'self';connect-src 'self';object-src 'none';base-uri 'self';form-action 'self';frame-ancestors 'none'
```

This matches isolated Express's production CSP. No policy relaxation or injected
rendering/download implementation. Final error-console capture is empty.

- **A33:** select Sample Group A weekly and only period 1. POST `:937` returns
  **200**, body `{"assignmentId":"b61de193-487f-4f26-bf3b-5b30c691b50b","periods":[1]}`.
  Actual `selected-period-1.csv`: **15 rows**, exclusively period 1. Native all-
  calendar control downloads `all-periods.csv`: **30 rows**, periods 1 and 2.
  Independent parser verifies every selected row equals the period-1 all-data row.
- **A31/A32:** Speed trend shows separate 14×14 legend and explicit **439×280**
  plot root. Actual Export downloads **36,764-byte 878×560 PNG** and **38,740-byte
  439×280 SVG** with line and two plotted points, rather than a legend icon.
  PNG visually inspected: chart line, points, axes and readable period label.
  `verify-export-downloads.py` independently parses SVG/CSV and PNG dimensions.
- **A34:** changing the chart kind to distribution preserves Speed and default
  latest-period selection; **four nonzero bars** render (heights 30.25, 90.75,
  181.5, 60.5). Explicit period 1 renders four bars with changed heights
  20.1667, 60.5, 181.5, 40.3333. No obsolete object-key empty distribution.
  Parameter-axis heatmap period 1 → 2 → 1 renders Sample Student 01 Speed
  **64 → 44 → 64**, matching both downloaded CSVs. Caption and selector agree.
- **A35:** period-axis heatmap headers/title text distinguish
  `Sample — Group A weekly · 1` and `Sample — Group A weekly · 2`; no truncated
  UUID-prefix ambiguity. Trend uses readable label, no `shared.periodKey`.
  At this narrow width Recharts elides one X-axis tick; no all-ticks claim.
  Comparison bar/radar capture and both-language labels are component-verified
  in the **11/11** suite, not additional live downloads.

Download IDs: selected CSV `file_a80228bc-d0f1-4424-a5bd-8907925b32ee`; all CSV
`file_52757bad-80b9-4a6c-836b-9d7fb1d27b12`; PNG
`file_36dd3e39-8a3c-4ec8-988c-4f1e32a23fa6`; SVG
`file_52e26c08-519f-404f-8d90-ecb657d973f2`. Original failing Stage 1 files remain
unchanged. A wait for literal `دورهٔ 1` timed out on the trend because its label
is the assignment/sequence string; inspection confirmed the plot before export.
