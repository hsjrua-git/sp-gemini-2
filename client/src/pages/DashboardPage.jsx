import { Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import { usePreferences } from '../preferences/PreferencesContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import CohortHero, { CohortPreload } from '../components/CohortHero.jsx';
import CohortDrawer from '../components/CohortDrawer.jsx';
import { lazyWithReload } from '../lib/lazyWithReload.js';
import SessionAlertsCard from '../components/SessionAlertsCard.jsx';
import StudentDrawer from '../components/StudentDrawer.jsx';
import UnmeasuredList from '../components/UnmeasuredList.jsx';
import ReportScopePicker from '../components/ReportScopePicker.jsx';
import TreePicker from '../components/TreePicker.jsx';
import { cohortField, parameterStats, studentBreakdown, summarize, unmeasuredStudents } from '../lib/dashboard.js';
import { dashboardResults, selectedTrend } from '../lib/reportResults.js';
import { useReportScope, useReportResults } from '../lib/useReportScope.js';

const ParameterDrawer = lazyWithReload(() => import('../components/ParameterDrawer.jsx'));

function DimensionDashboard({ data, dimension, options }) {
  const { t } = useTranslation(['reports', 'workflows']);
  const results = useMemo(() => dashboardResults(data), [data]);
  const viewOptions = useMemo(() => ({ dimension, basis: options.basis }), [dimension, options.basis]);
  const summary = useMemo(() => summarize(results, viewOptions), [results, viewOptions]);
  const field = useMemo(() => cohortField(results, viewOptions), [results, viewOptions]);
  const stats = useMemo(() => parameterStats(results, viewOptions), [results, viewOptions]);
  const unmeasured = useMemo(() => unmeasuredStudents(results, viewOptions), [results, viewOptions]);
  const [target, setTarget] = useState(null);
  const [parameterOpened, setParameterOpened] = useState(false);
  const select = next => { if (next.type === 'parameter') setParameterOpened(true); setTarget(next); };
  const stat = target?.type === 'parameter' ? stats.find(s => s.parameter.id === target.id) : null;
  const student = target?.type === 'student' ? studentBreakdown(results, target.id, viewOptions) : null;
  const close = () => setTarget(null);
  return <section className="section-card">
    <h2>{t(`workflows:scope.${dimension}`)}</h2>
    <CohortHero summary={summary} field={field} stats={stats} onSelect={select} mode={options.mode} autoRotate={options.autoRotate !== false} />
    <h3>{t('dashboard.needsScoring')}</h3><UnmeasuredList items={unmeasured} />
    {parameterOpened && <Suspense fallback={<p role="status">{t('common:status.loading')}</p>}>
      <ParameterDrawer open={Boolean(stat)} stat={stat} trend={stat ? selectedTrend(data, stat.parameter, dimension) : []} onClose={close} />
    </Suspense>}
    <StudentDrawer open={Boolean(student)} breakdown={student} onClose={close} />
    <CohortDrawer open={target?.type === 'cohort'} summary={summary} onClose={close} />
  </section>;
}

export default function DashboardPage() {
  const { t } = useTranslation(['reports', 'common', 'workflows']);
  const { can } = useAuth();
  const { preferences, update } = usePreferences();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const options = preferences.dashboardConstellation ?? {};
  const report = useReportScope();
  const query = useReportResults(report);
  const error = report.error || query.error;
  const persist = changes => update.mutate({ dashboardConstellation: changes });
  const scopeKey = report.selectedPeriods.map(p => p.id).join(',');
  const selectedData = useMemo(() => query.data && options.parameterIds != null ? {
    ...query.data, parameters: query.data.parameters.filter(parameter => options.parameterIds.includes(parameter.id)),
  } : query.data, [query.data, options.parameterIds]);
  return <main className="wide">
    <CohortPreload mode={options.mode} />
    <div className="page-head"><h1>{t('dashboard.title')}</h1>
      <div className="page-head-actions">
        {can('scores.enter') && <Link className="btn primary" to="/evaluate">{t('dashboard.enterScores')}</Link>}
        {can('data.export') && <Link className="btn" to="/export">{t('workflows:scope.export')}</Link>}
      </div>
    </div>
    <SessionAlertsCard />
    <details className="panel" onToggle={event => setSettingsOpen(event.currentTarget.open)}><summary>{t('dashboard.optionsTitle')} · {t('workflows:scope.summary', { periods: report.selectedPeriods.length, dimensions: report.scope.dimensions.map(d => t(`workflows:scope.${d}`)).join(' + ') })}</summary>
      {settingsOpen && <><ReportScopePicker report={report} />
      <div className="toolbar">
        <fieldset className="segmented"><legend>{t('dashboard.basisLabel')}</legend>
          {['value', 'valueOrComment'].map(value => <label key={value}><input type="radio" name="dashboard-basis" checked={(options.basis ?? 'value') === value} onChange={() => persist({ basis: value })} />{t(`dashboard.${value}`)}</label>)}
        </fieldset>
        <fieldset className="segmented"><legend>{t('dashboard.viewModeLabel')}</legend>
          {['auto', '3d', '2d'].map(value => <label key={value}><input type="radio" name="dashboard-mode" checked={(options.mode ?? 'auto') === value} onChange={() => persist({ mode: value })} />{t(`dashboard.viewMode.${value}`)}</label>)}
        </fieldset>
        <label className="inline"><input type="checkbox" checked={options.autoRotate !== false} onChange={event => persist({ autoRotate: event.target.checked })} />{t('dashboard.autoRotate')}</label>
      </div></>}
    </details>
    <p className="hint">{t('workflows:scope.details')}</p>
    {query.data && <section className="panel dashboard-parameters">
      <TreePicker label={t('workflows:orbits.parameters')} items={query.data.parameters} value={options.parameterIds ?? query.data.parameters.map(parameter => parameter.id)} onChange={parameterIds => persist({ parameterIds })} includeBranch emptyHint={t('workflows:tree.choose')} />
      <p className="hint">{t('workflows:orbits.help')}</p>
      {options.parameterIds != null && <button type="button" className="quiet" onClick={() => persist({ parameterIds: null })}>{t('workflows:orbits.reset')}</button>}
    </section>}
    {query.isPending && <p role="status">{t('common:status.loading')}</p>}
    {error && <p className="error" role="alert">{errorMessage(error)}</p>}
    {query.tooMany && <p className="error">{t('workflows:scope.limit')}</p>}
    {!query.isPending && !report.selectedPeriods.length && <p>{t('workflows:scope.empty')}</p>}
    {selectedData && !selectedData.parameters.length && <p role="status">{t('workflows:orbits.empty')}</p>}
    {selectedData?.parameters.length > 0 && report.scope.dimensions.map(dimension => <DimensionDashboard key={`${scopeKey}:${dimension}`} data={selectedData} dimension={dimension} options={options} />)}
  </main>;
}
