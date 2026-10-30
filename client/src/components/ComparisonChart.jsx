import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cohortAverages } from '../lib/cube.js';
import { CHART_TOOLTIP, seriesClass } from '../lib/chartTheme.js';
import { useLocale } from '../lib/locale.js';

// Compare several parameters at once, cohort-average per period. Two shapes over
// the same data: grouped bars (period on X, a bar per parameter) or a radar
// (period per spoke, a polygon per parameter). Series are coloured through the
// --series-* CSS slots via seriesClass, so they stay distinct and theme-aware.
function ComparisonChart({ cube, parameterIds, shape = 'bar' }) {
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
      const row = { label: t('shared.periodLabel', { label: period.label }) };
      for (const item of series) row[item.parameter.id] = item.points[index].average;
      return row;
    });
  }, [cube, params, t]);

  if (params.length === 0) {
    return <p className="hint">{t('charts.compareNeedParameter')}</p>;
  }
  if (cube.periods.length === 0) {
    return <p className="hint">{t('charts.noPeriods')}</p>;
  }

  if (shape === 'radar') {
    return (
      <div className="chart-box">
        <ResponsiveContainer width="100%" height={320}>
          <RadarChart data-chart-root data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <PolarGrid />
            <PolarAngleAxis dataKey="label" tick={{ fill: 'currentColor', fontSize: 12 }} />
            <PolarRadiusAxis domain={cube.dimension === 'quality' ? [0, 100] : undefined} tick={{ fill: 'currentColor', fontSize: 11 }} />
            <Tooltip {...CHART_TOOLTIP} />
            <Legend />
            {params.map((parameter, index) => (
              <Radar
                key={parameter.id}
                className={seriesClass(index)}
                dataKey={parameter.id}
                name={parameter.path || parameter.name}
                fillOpacity={0.15}
                isAnimationActive={false}
              />
            ))}
          </RadarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data-chart-root data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fill: 'currentColor', fontSize: 12 }}
            reversed={isRtl}
          />
          <YAxis
            domain={cube.dimension === 'quality' ? [0, 100] : undefined}
            tick={{ fill: 'currentColor', fontSize: 12 }}
            width={40}
            orientation={isRtl ? 'right' : 'left'}
          />
          <Tooltip {...CHART_TOOLTIP} cursor={false} />
          <Legend />
          {params.map((parameter, index) => (
            <Bar
              key={parameter.id}
              className={seriesClass(index)}
              dataKey={parameter.id}
              name={parameter.path || parameter.name}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ComparisonChart;
