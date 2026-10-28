import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getCafeReport } from '../api/cafeReports.js';
import EmptyState from '../components/EmptyState.jsx';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import StatCard from '../components/StatCard.jsx';
import { errorMessage } from '../i18n/errors.js';
import { formatIsoDate, toIsoDate } from '../lib/format.js';
import { startOfJalaliMonth } from '../lib/locale.js';
import { formatWhole } from '../lib/money.js';

// The cafe range report: totals, a daily breakdown and top products over the
// picked from/to range, plus the standing numbers (stock value, active
// products, student debt) that are always current. Everything is read-only.
// Like the other cafe pages, amounts keep Latin digits with thousands
// separators (data, not UI chrome); only the unit word is translated.
const qtyFormat = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 3,
});

function formatNumber(value) {
  return formatWhole(Number(value ?? 0));
}

function formatQty(value) {
  return qtyFormat.format(Number(value ?? 0));
}

// The institution runs on the Jalali calendar, so the report opens on the
// first day of the current Jalali month; the range sent to the server stays
// ISO Gregorian either way.
// A KPI tile on the existing stat-card styles (same markup HeadlineCards
function CafeReportsPage() {
  const { t } = useTranslation(['cafeReports', 'common']);
  const today = new Date();

  const [from, setFrom] = useState(toIsoDate(startOfJalaliMonth(today)));
  const [to, setTo] = useState(toIsoDate(today));

  const reportQuery = useQuery({
    queryKey: ['cafe-reports', { from, to }],
    queryFn: () => getCafeReport({ from, to }),
    // The Jalali field can clear the value mid-edit; fetch only complete
    // ranges.
    enabled: from !== '' && to !== '',
  });
  const report = reportQuery.data;
  const hasDebt = Number(report?.debtorCount ?? 0) > 0;

  return (
    <main className="wide">
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p className="hint">{t('hint')}</p>
        </div>
      </div>

      <section className="section-card">
        <h2>{t('totals.title')}</h2>
        <div className="toolbar">
          <label htmlFor="cafe-reports-from">{t('range.from')}</label>
          <JalaliDatePicker id="cafe-reports-from" value={from} onChange={setFrom} />
          <label htmlFor="cafe-reports-to">{t('range.to')}</label>
          <JalaliDatePicker id="cafe-reports-to" value={to} onChange={setTo} />
        </div>

        {reportQuery.isPending && (
          <p className="hint">{t('common:status.loading')}</p>
        )}
        {reportQuery.isError && (
          <p className="error" role="alert">
            {errorMessage(reportQuery.error)}
          </p>
        )}

        {report && (
          <div className="stat-grid">
            <StatCard
              label={t('totals.saleCount')}
              value={formatNumber(report.totals.saleCount)}
            />
            <StatCard
              label={t('totals.revenue')}
              value={
                <>
                  <bdi>{formatNumber(report.totals.revenue)}</bdi>{' '}
                  <span className="hint">{t('money.unit')}</span>
                </>
              }
            />
            <StatCard
              label={t('totals.cost')}
              value={
                <>
                  <bdi>{formatNumber(report.totals.cost)}</bdi>{' '}
                  <span className="hint">{t('money.unit')}</span>
                </>
              }
            />
            <StatCard
              label={t('totals.profit')}
              value={
                <>
                  <bdi>{formatNumber(report.totals.profit)}</bdi>{' '}
                  <span className="hint">{t('money.unit')}</span>
                </>
              }
              tone={Number(report.totals.profit) < 0 ? 'danger' : undefined}
            />
            <StatCard
              label={t('totals.purchases')}
              value={
                <>
                  <bdi>{formatNumber(report.purchasesTotal)}</bdi>{' '}
                  <span className="hint">{t('money.unit')}</span>
                </>
              }
            />
            <StatCard
              label={t('totals.waste')}
              value={
                <>
                  <bdi>{formatNumber(report.wasteValue)}</bdi>{' '}
                  <span className="hint">{t('money.unit')}</span>
                </>
              }
            />
          </div>
        )}
      </section>

      {report && (
        <section className="section-card">
          <h2>{t('daily.title')}</h2>
          {report.daily.length === 0 ? (
            <EmptyState
              title={t('empty.title')}
              description={t('empty.description')}
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('daily.colDay')}</th>
                    <th scope="col">{t('daily.colSaleCount')}</th>
                    <th scope="col">{t('daily.colRevenue')}</th>
                    <th scope="col">{t('daily.colCost')}</th>
                    <th scope="col">{t('daily.colProfit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.daily.map((day) => (
                    <tr key={day.day}>
                      <th scope="row">{formatIsoDate(day.day)}</th>
                      <td>{formatNumber(day.saleCount)}</td>
                      <td className="nowrap">
                        <bdi>{formatNumber(day.revenue)}</bdi>{' '}
                        <span className="hint">{t('money.unit')}</span>
                      </td>
                      <td className="nowrap">
                        <bdi>{formatNumber(day.cost)}</bdi>{' '}
                        <span className="hint">{t('money.unit')}</span>
                      </td>
                      <td className={Number(day.profit) < 0 ? 'error nowrap' : 'nowrap'}>
                        <bdi>{formatNumber(day.profit)}</bdi>{' '}
                        <span className="hint">{t('money.unit')}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {report && (
        <section className="section-card">
          <h2>{t('top.title')}</h2>
          {report.topProducts.length === 0 ? (
            <EmptyState
              title={t('empty.title')}
              description={t('empty.description')}
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('top.colProduct')}</th>
                    <th scope="col">{t('top.colQty')}</th>
                    <th scope="col">{t('top.colRevenue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topProducts.map((product) => (
                    <tr key={product.id}>
                      <th scope="row">{product.productName}</th>
                      <td>
                        <bdi>{formatQty(product.qty)}</bdi>
                      </td>
                      <td className="nowrap">
                        <bdi>{formatNumber(product.revenue)}</bdi>{' '}
                        <span className="hint">{t('money.unit')}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {report && (
        <section className="section-card">
          <h2>{t('standing.title')}</h2>
          <div className="stat-grid">
            <StatCard
              label={t('standing.inventoryValue')}
              value={
                <>
                  <bdi>{formatNumber(report.inventoryValue)}</bdi>{' '}
                  <span className="hint">{t('money.unit')}</span>
                </>
              }
            />
            <StatCard
              label={t('standing.activeProducts')}
              value={formatNumber(report.activeProducts)}
            />
            <StatCard
              label={t('standing.debtorCount')}
              value={formatNumber(report.debtorCount)}
              tone={hasDebt ? 'danger' : undefined}
            />
            <StatCard
              label={t('standing.outstandingDebt')}
              value={
                <>
                  {/* Balances are negative when owing, so the debt figure
                      arrives negative — show its magnitude. */}
                  <bdi>{formatNumber(Math.abs(Number(report.outstandingDebt)))}</bdi>{' '}
                  <span className="hint">{t('money.unit')}</span>
                </>
              }
              tone={hasDebt ? 'danger' : undefined}
            />
          </div>
        </section>
      )}
    </main>
  );
}

export default CafeReportsPage;
