import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_TOOLTIP } from '../lib/chartTheme.js';
import { formatChange, formatShortIsoDate } from '../lib/format.js';
import { buildHistory } from '../lib/history.js';
import { useLocale } from '../lib/locale.js';
import { parameterView } from '../lib/views.js';
import { dimensionRange } from '../lib/dimensions.js';
import HierarchySelect from './HierarchySelect.jsx';

// "By parameter": one parameter's evolution over the student's sessions, in
// the viewed dimension. Whole-group values (where the student has no cell of
// their own) are drawn hollow and marked in the table.
function ByParameterView({ evaluations, parameters, dimension }) {
  const { t } = useTranslation(['reports', 'common']);
  const { isRtl } = useLocale();
  const [chosenId, setChosenId] = useState(null);
  const gradientId = useId();

  const columns = useMemo(
    () => buildHistory({ evaluations, parameters }).columns,
    [evaluations, parameters]
  );

  if (columns.length === 0) {
    return <p>{t('shared.noParametersYet')}</p>;
  }

  const scoredIds = new Set(evaluations.map((item) => item.parameterId));
  const defaultId = (columns.find((c) => scoredIds.has(c.id)) ?? columns[0]).id;
  const parameterId = columns.some((c) => c.id === chosenId)
    ? chosenId
    : defaultId;
  const parameter = columns.find((c) => c.id === parameterId);
  const range = dimensionRange(parameter, dimension);

  const { points, stats } = parameterView({
    evaluations,
    parameterId,
    dimension,
  });
  const chartData = points.map((point) => ({
    label: formatShortIsoDate(point.sessionDate),
    value: point.value,
  }));

  return (
    <>
      <label className="inline">
        {t('shared.parameter')}
        <HierarchySelect items={columns} value={parameterId} onChange={setChosenId} />
      </label>

      {!stats ? (
        <p>{t('byParameter.noScores', { name: parameter.name })}</p>
      ) : (
        <>
          <p className="summary">
            {t('byParameter.latest')} <strong>{stats.latest.value}</strong>{' '}
            {t('byParameter.onDate', {
              date: formatShortIsoDate(stats.latest.sessionDate),
            })}{' '}
            · {t('charts.averageLabel')} <strong>{stats.average}</strong>
            {stats.change !== null && (
              <>
                {' '}
                · {t('byParameter.sinceFirst')}{' '}
                <strong>{formatChange(stats.change)}</strong>
              </>
            )}{' '}
            · {t('byParameter.scoreCount', { count: stats.count })}
          </p>

          <div className="chart-box">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart
                data={chartData}
                margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      style={{ stopColor: 'var(--brand)', stopOpacity: 0.26 }}
                    />
                    <stop
                      offset="100%"
                      style={{ stopColor: 'var(--brand)', stopOpacity: 0 }}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'currentColor', fontSize: 12 }}
                  reversed={isRtl}
                />
                <YAxis
                  domain={[range.minValue ?? 'auto', range.maxValue ?? 'auto']}
                  tick={{ fill: 'currentColor', fontSize: 12 }}
                  width={40}
                  orientation={isRtl ? 'right' : 'left'}
                />
                <Tooltip {...CHART_TOOLTIP} cursor={{ strokeDasharray: '3 3' }} />
                <Area
                  type="linear"
                  dataKey="value"
                  name={parameter.name}
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                  fillOpacity={1}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('history.sessionCol')}</th>
                  <th className="num">{t('shared.score')}</th>
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((point) => (
                  <tr key={point.sessionId}>
                    <td>{formatShortIsoDate(point.sessionDate)}</td>
                    <td className="num">
                      {point.value === null ? (
                        <span className="muted" title={t('history.selectedNotAnswered')}>
                          ·
                        </span>
                      ) : (
                        point.value
                      )}
                      {point.viaGroup && (
                        <span className="hint" title={t('history.viaGroup')}>
                          *
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export default ByParameterView;
