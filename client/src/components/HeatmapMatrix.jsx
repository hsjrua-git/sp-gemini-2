import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { buildHeatmap } from '../lib/heatmap.js';

// A student × axis matrix, each cell shaded by where the score sits in the
// parameter's range. Hand-drawn SVG (not recharts) so it exports cleanly: the
// fills use CSS color-mix through an inline `style`, which resolves on screen
// AND is inlined as a concrete colour when `chartImage.js` serialises the SVG.
const CELL_W = 46;
const CELL_H = 26;
const LEFT = 150;
const TOP = 30;
const GAP = 2;

function truncate(text, max = 20) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function HeatmapMatrix({ cube, axis = 'period', parameterId = null, periodKey = null }) {
  const { t } = useTranslation(['reports', 'common']);
  const model = useMemo(
    () => buildHeatmap(cube, { axis, parameterId, periodKey }),
    [cube, axis, parameterId, periodKey]
  );

  const { rows, columns, cells } = model;
  if (rows.length === 0 || columns.length === 0) {
    return <p className="hint">{t('heatmap.empty')}</p>;
  }

  const columnWidth = axis === 'period'
    ? Math.max(CELL_W, ...columns.map(column => String(column.label).length * 7 + 16))
    : CELL_W;
  const width = LEFT + columns.length * columnWidth;
  const height = TOP + rows.length * CELL_H;
  const caption =
    axis === 'parameter'
      ? t('heatmap.captionParameter', { number: model.periodLabel ?? '—' })
      : t('heatmap.captionPeriod', { name: model.parameterName ?? '—' });

  return (
    <div className="chart-box">
      <p className="hint">{caption}</p>
      <div className="heatmap-wrap">
        <svg
          data-chart-root
          className="heatmap-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={t('heatmap.aria', { caption })}
        >
          {columns.map((column, columnIndex) => (
            <text
              key={`h-${column.key}`}
              x={LEFT + columnIndex * columnWidth + columnWidth / 2}
              y={TOP - 10}
              textAnchor="middle"
              style={{ fill: 'var(--ink-soft)', fontSize: '11px', fontWeight: 600 }}
            >
              {axis === 'period' ? column.label : truncate(String(column.label), 8)}
              <title>{column.label}</title>
            </text>
          ))}
          {rows.map((row, rowIndex) => (
            <text
              key={`r-${row.id}`}
              x={LEFT - 8}
              y={TOP + rowIndex * CELL_H + CELL_H / 2}
              textAnchor="end"
              dominantBaseline="middle"
              style={{ fill: 'var(--ink)', fontSize: '11px' }}
            >
              {truncate(row.label)}
            </text>
          ))}
          {rows.map((row, rowIndex) =>
            columns.map((column, columnIndex) => {
              const cell = cells[rowIndex][columnIndex];
              const filled = cell.value !== null && cell.percent !== null;
              const fill = filled
                ? `color-mix(in srgb, var(--brand) ${cell.percent}%, var(--surface-2))`
                : 'var(--surface-2)';
              const textFill = filled && cell.percent > 55 ? 'var(--surface)' : 'var(--ink)';
              const x = LEFT + columnIndex * columnWidth;
              const y = TOP + rowIndex * CELL_H;
              return (
                <g key={`${row.id}-${column.key}`}>
                  <rect
                    x={x + GAP / 2}
                    y={y + GAP / 2}
                    width={columnWidth - GAP}
                    height={CELL_H - GAP}
                    rx="3"
                    style={{ fill, stroke: 'var(--surface)', strokeWidth: 1 }}
                  >
                    <title>
                      {cell.value === null
                        ? t('heatmap.cellNoScore', {
                            row: row.label,
                            column: column.label,
                          })
                        : t('heatmap.cellScore', {
                            row: row.label,
                            column: column.label,
                            value: cell.value,
                          })}
                    </title>
                  </rect>
                  {cell.value !== null && (
                    <text
                      x={x + columnWidth / 2}
                      y={y + CELL_H / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      style={{ fill: textFill, fontSize: '10px' }}
                    >
                      {cell.value}
                    </text>
                  )}
                </g>
              );
            })
          )}
        </svg>
      </div>
    </div>
  );
}

export default HeatmapMatrix;
