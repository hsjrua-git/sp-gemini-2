// Shared recharts presentation helper.
//
// Chart *geometry* (grid, axes, line/area strokes, dots, bars) is recolored in
// index.css via the `.recharts-*` classes, so it tracks the theme AND the
// selected palette with no JavaScript — CSS `stroke`/`fill` properties override
// recharts' SVG presentation attributes and are allowed to resolve var().
//
// The tooltip is the exception: recharts renders it as a real HTML popover, and
// its default inline white background does not adapt to dark mode. These inline
// styles fix that. Because the popover is HTML (not SVG), var() resolves here,
// so the tooltip also tracks the theme + palette. Spread onto <Tooltip> with
// {...CHART_TOOLTIP}.
export const CHART_TOOLTIP = {
  contentStyle: {
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: '10px',
    boxShadow: 'var(--shadow-md)',
    color: 'var(--ink)',
    fontSize: '0.82rem',
  },
  labelStyle: { color: 'var(--ink-soft)', fontWeight: 600 },
  itemStyle: { color: 'var(--ink)' },
};

// A multi-series chart (trend / comparison) cycles each series onto one of the
// six --series-* palette slots defined in index.css. Give every recharts
// <Line>/<Bar>/<Radar> className={seriesClass(i)}; the per-series CSS rules then
// colour its geometry distinctly, and — because those rules resolve var() — the
// colours track the theme and palette AND survive the computed-style inlining
// that `chartImage.js` does when exporting the chart to PNG/SVG.
export const SERIES_COUNT = 6;

export function seriesClass(index) {
  return `series-${(index % SERIES_COUNT) + 1}`;
}
