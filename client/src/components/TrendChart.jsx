import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cohortAverages } from '../lib/cube.js';
import { CHART_TOOLTIP, seriesClass } from '../lib/chartTheme.js';
import { useLocale } from '../lib/locale.js';

// Cohort-average trend over periods: one line per selected parameter, each point
// the mean of every (filtered) student's value that period. Reads straight from
// the export cube so it matches the exported data exactly. Animation is off so
// the geometry is final the moment it paints — the Export run captures this very
// SVG, and a mid-tween capture would freeze half-drawn lines.
function TrendChart({ cube, parameterIds }) {
  const { t } = useTranslation(['reports', 'common']);
  const { isRtl } = useLocale();
  const ids = useMemo(() => new Set(parameterIds), [parameterIds]);
  const params = useMemo(
    () => cube.parameters.filter((parameter) => ids.has(parameter.id)),
    [cube.parameters, ids]
  );

  const data = useMemo(() => {
    const series = params.map((parameter) => ({
      parameter,
      points: cohortAverages(cube, parameter.id),
    }));
    return cube.periods.map((period, index) => {
      const row = { label: t('shared.periodKey', { label: period.label }) };
      for (const item of series) row[item.parameter.id] = item.points[index].average;
      return row;
    });
  }, [cube, params, t]);

  if (params.length === 0) {
    return <p className="hint">{t('charts.trendNeedParameter')}</p>;
  }
  if (cube.periods.length === 0) {
    return <p className="hint">{t('charts.noPeriods')}</p>;
  }

  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fill: 'currentColor', fontSize: 12 }}
            reversed={isRtl}
          />
          <YAxis
            tick={{ fill: 'currentColor', fontSize: 12 }}
            width={40}
            orientation={isRtl ? 'right' : 'left'}
          />
          <Tooltip {...CHART_TOOLTIP} cursor={{ strokeDasharray: '3 3' }} />
          <Legend />
          {params.map((parameter, index) => (
            <Line
              key={parameter.id}
              className={seriesClass(index)}
              type="linear"
              dataKey={parameter.id}
              name={parameter.name}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default TrendChart;
