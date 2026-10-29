import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cubeValues } from '../lib/cube.js';
import { distribution } from '../lib/dashboard.js';
import { CHART_TOOLTIP } from '../lib/chartTheme.js';
import { useLocale } from '../lib/locale.js';

// How many students scored in each band of a parameter's range, for one period.
// Single-series, so it keeps the base brand bar colour (no series class). Bins
// come from the shared `distribution` helper the dashboard uses, fed the cube's
// values so the chart agrees with the exported data.
function DistributionChart({ cube, parameterId, periodKey }) {
  const { t } = useTranslation(['reports', 'common']);
  const { isRtl } = useLocale();
  const parameter = useMemo(
    () =>
      cube.parameters.find((item) => item.id === parameterId) ??
      cube.parameters[0] ??
      null,
    [cube.parameters, parameterId]
  );
  const period = periodKey ?? cube.lastPeriod?.key ?? null;

  const bins = useMemo(() => {
    if (!parameter || period === null) return [];
    return distribution(cubeValues(cube, parameter.id, period), parameter);
  }, [cube, parameter, period]);

  if (!parameter) {
    return <p className="hint">{t('charts.chooseParameter')}</p>;
  }
  if (bins.length === 0) {
    return (
      <p className="hint">
        {t('charts.noScoresFor', { name: parameter.name, number: period ?? '—' })}
      </p>
    );
  }

  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data-chart-root data={bins} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fill: 'currentColor', fontSize: 12 }}
            reversed={isRtl}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: 'currentColor', fontSize: 12 }}
            width={40}
            orientation={isRtl ? 'right' : 'left'}
          />
          <Tooltip {...CHART_TOOLTIP} cursor={false} />
          <Bar
            dataKey="count"
            name={t('charts.seriesStudents')}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default DistributionChart;
