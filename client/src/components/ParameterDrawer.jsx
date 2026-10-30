import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { distribution } from '../lib/dashboard.js';
import { CHART_TOOLTIP } from '../lib/chartTheme.js';
import { formatChange, formatParameterHint } from '../lib/format.js';
import { useLocale } from '../lib/locale.js';
import { CloseIcon } from './icons.jsx';
import Drawer from './Drawer.jsx';
import { dimensionRange } from '../lib/dimensions.js';

const AXIS = { fill: 'currentColor', fontSize: 11 };
const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

// The full picture for one parameter: the summary line plus the trend and
// distribution charts that used to sit in a grid of cards below the hero. Those
// charts are detail, not overview, so they live behind a click on the parameter's
// satellite — the dashboard stays a single glowing object, and the depth opens on
// demand. Focus is trapped while open, Escape and the scrim close it, and focus
// returns to the satellite that opened it (handled in the effect's cleanup).
function DrawerBody({ stat, trend, trendError, titleId, onClose }) {
  const { t } = useTranslation(['reports', 'common']);
  const { isRtl } = useLocale();
  const gradientId = useId();
  const { parameter } = stat;
  const range = dimensionRange(parameter, stat.dimension);
  const bins = distribution(stat.values, range);
  const trendData = trend.map((point) => ({
    label: point.label,
    average: point.average,
  }));
  const hasTrend = trend.some((point) => point.average !== null);
  const hint = formatParameterHint(parameter, stat.dimension);

  return (
    <>
      <header className="drawer-head">
        <h2 id={titleId} className="drawer-title">
          {parameter.name}
          {hint && <span className="hint"> {hint}</span>}
        </h2>
        <button
          type="button"
          className="drawer-close"
          onClick={onClose}
          aria-label={t('common:actions.close')}
        >
          <CloseIcon size={18} />
        </button>
      </header>

      {stat.count === 0 ? (
        <p>{t('parameterDrawer.noScores')}</p>
      ) : (
        <p className="summary">
          {t('charts.averageLabel')} <strong>{stat.average}</strong> ·{' '}
          {t('parameterDrawer.lowestLabel')} {stat.min} ·{' '}
          {t('parameterDrawer.highestLabel')} {stat.max} ·{' '}
          {t('parameterDrawer.measuredCount', { count: stat.count })}
          {stat.averageChange !== null && (
            <>
              {' '}
              · <strong>{formatChange(stat.averageChange)}</strong>{' '}
              {t('parameterDrawer.vsPrevious', {
                students: t('parameterDrawer.studentsPaired', {
                  count: stat.paired,
                }),
              })}
            </>
          )}
        </p>
      )}

      {hasTrend && (
        <>
          <h3 className="drawer-chart-title">
            {t('charts.classAverageTitle')}
          </h3>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={trendData} margin={MARGIN}>
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
                tick={AXIS}
                interval="preserveStartEnd"
                reversed={isRtl}
              />
              <YAxis
                  domain={[range.minValue ?? 'auto', range.maxValue ?? 'auto']}
                tick={AXIS}
                width={32}
                orientation={isRtl ? 'right' : 'left'}
              />
              <Tooltip {...CHART_TOOLTIP} cursor={{ strokeDasharray: '3 3' }} />
              <Area
                type="linear"
                dataKey="average"
                name={t('charts.seriesClassAverage')}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                fillOpacity={1}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}

      {!hasTrend && trendError && (
        <p className="hint">
          {t('parameterDrawer.trendError', { error: trendError })}
        </p>
      )}

      {stat.count > 0 && bins.length > 0 && (
        <>
          <h3 className="drawer-chart-title">{t('charts.spreadTitle')}</h3>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={bins} margin={MARGIN}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={AXIS} reversed={isRtl} />
              <YAxis
                allowDecimals={false}
                tick={AXIS}
                width={28}
                orientation={isRtl ? 'right' : 'left'}
              />
              <Tooltip {...CHART_TOOLTIP} />
              <Bar
                dataKey="count"
                name={t('charts.seriesStudents')}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </>
  );
}

function ParameterDrawer({ open, stat, trend = [], trendError = null, onClose }) {
  const titleId = useId();
  // Keep the last shown parameter around so the panel doesn't flash empty during
  // the slide-out: when the dashboard clears the selection on close, `stat` goes
  // null, but we render the cached view until the panel is off-screen. Adjusting
  // state during render is React's endorsed alternative to an effect for
  // "remember the last props" — the same pattern Layout uses for lastPath. While
  // a parameter is selected we mirror the live view into `cached`; the guard
  // makes it a no-op once they match, so it settles in one extra render and never
  // loops. On open `view` uses the live props directly, so the cache only matters
  // once closing has begun and `stat` is already null.
  const [cached, setCached] = useState(null);
  if (
    stat &&
    (cached?.stat !== stat ||
      cached?.trend !== trend ||
      cached?.trendError !== trendError)
  ) {
    setCached({ stat, trend, trendError });
  }
  const view = stat ? { stat, trend, trendError } : cached;

  return (
    <Drawer open={open} titleId={titleId} onClose={onClose}>
      {view && (
        <DrawerBody
          stat={view.stat}
          trend={view.trend}
          trendError={view.trendError}
          titleId={titleId}
          onClose={onClose}
        />
      )}
    </Drawer>
  );
}

export default ParameterDrawer;
