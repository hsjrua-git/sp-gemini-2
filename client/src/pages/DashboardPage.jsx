import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getTrends } from '../api/dashboard.js';
import { getResults } from '../api/results.js';
import { getPeriods } from '../api/periods.js';
import { listAssignments } from '../api/schedule.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { usePreferences } from '../preferences/PreferencesContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import GroupFilter from '../components/GroupFilter.jsx';
import CohortHero from '../components/CohortHero.jsx';
import CohortDrawer from '../components/CohortDrawer.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ParameterDrawer from '../components/ParameterDrawer.jsx';
import SessionAlertsCard from '../components/SessionAlertsCard.jsx';
import StudentDrawer from '../components/StudentDrawer.jsx';
import UnmeasuredList from '../components/UnmeasuredList.jsx';
import {
  cohortField,
  dashboardPeriodSeq,
  parameterStats,
  studentBreakdown,
  summarize,
  trendSeries,
  unmeasuredStudents,
} from '../lib/dashboard.js';
import { formatIsoDate } from '../lib/format.js';

const DIMENSIONS = ['quality', 'quantity'];
const BASES = ['value', 'valueOrComment'];

// The dashboard: one assignment period's class field (the grid the hero and
// the 3D constellation render from), with the customization — which
// assignment period, which dimension feeds the values, and what counts as
// "answered" — persisted per user in the dashboardConstellation preference.
function DashboardPage() {
  const { t } = useTranslation(['reports', 'common']);
  const { can } = useAuth();
  const { preferences, update } = usePreferences();
  const options = preferences.dashboardConstellation ?? {};
  const groupId = options.groupId ?? '';

  const assignmentsQuery = useQuery({
    queryKey: ['assignments'],
    queryFn: listAssignments,
  });
  const assignments = assignmentsQuery.data ?? [];
  const scopedAssignments = groupId
    ? assignments.filter((assignment) => assignment.groupId === groupId)
    : assignments;
  const assignmentId = scopedAssignments.some((assignment) => assignment.id === options.assignmentId)
    ? options.assignmentId
    : scopedAssignments[0]?.id ?? null;

  const periodsQuery = useQuery({
    queryKey: ['periods', assignmentId],
    queryFn: () => getPeriods(assignmentId),
    enabled: assignmentId !== null,
  });
  const periods = useMemo(
    () => (periodsQuery.data ?? []).filter((period) => period.sessionCount > 0),
    [periodsQuery.data]
  );
  const seq = dashboardPeriodSeq(periods, options.seq);
  const dimension = options.dimension === 'quantity' ? 'quantity' : 'quality';
  const basis =
    options.basis === 'valueOrComment' ? 'valueOrComment' : 'value';
  const mode = ['2d', '3d'].includes(options.mode) ? options.mode : 'auto';
  const autoRotate = options.autoRotate !== false;

  const resultsQuery = useQuery({
    queryKey: ['results', { assignmentId, seq, dimension }],
    queryFn: () => getResults({ assignmentId, seq, dimension }),
    enabled: assignmentId !== null && seq !== null,
  });
  const trendsQuery = useQuery({
    queryKey: ['trends', { groupId, dimension }],
    queryFn: () => getTrends({ groupId: groupId || null, dimension }),
  });

  const results = resultsQuery.data;
  const viewOptions = useMemo(
    () => ({ dimension, basis }),
    [dimension, basis]
  );
  const summary = useMemo(
    () => (results ? summarize(results, viewOptions) : null),
    [results, viewOptions]
  );
  const cohort = useMemo(
    () => (results ? cohortField(results, viewOptions) : []),
    [results, viewOptions]
  );
  const stats = useMemo(
    () => (results ? parameterStats(results, viewOptions) : []),
    [results, viewOptions]
  );
  const unmeasured = useMemo(
    () => (results ? unmeasuredStudents(results, viewOptions) : []),
    [results, viewOptions]
  );
  // Which detail drawer is open: {type:'parameter'|'student'|'cohort', id?} or
  // null. All three drawers stay mounted so their slide-in/out is pure CSS;
  // closing just clears the target and each panel keeps its last content (its own
  // render-time cache) until it is off-screen.
  const [openTarget, setOpenTarget] = useState(null);
  function closeDrawer() {
    setOpenTarget(null);
  }

  function persist(changes) {
    update.mutate({ dashboardConstellation: changes });
  }

  if (assignmentsQuery.isPending) {
    return (
      <main aria-busy="true">
        <div className="page-loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <p>{t('common:status.loading')}</p>
        </div>
      </main>
    );
  }
  if (assignmentsQuery.isError) {
    return (
      <main>
        <EmptyState
          tone="danger"
          title={t('dashboard.errorTitle')}
          description={errorMessage(assignmentsQuery.error)}
        />
      </main>
    );
  }

  // The open drawer's data, derived from the unified target. Only one type is
  // ever active at a time; the others resolve to null so their (always-mounted)
  // drawer renders its cached content while closed.
  const openParamId = openTarget?.type === 'parameter' ? openTarget.id : null;
  const openStat =
    openParamId !== null
      ? stats.find((stat) => stat.parameter.id === openParamId) ?? null
      : null;
  const openTrend = openStat
    ? trendSeries({ trends: trendsQuery.data ?? [], parameterId: openParamId })
    : [];
  const openStudent =
    openTarget?.type === 'student' && results
      ? studentBreakdown(results, openTarget.id, viewOptions)
      : null;
  const openCohort = openTarget?.type === 'cohort' ? summary : null;

  return (
    <main className="wide">
      <div className="page-head">
        <h1>{t('dashboard.title')}</h1>
        {can('scores.enter') && (
          <div className="page-head-actions">
            <Link className="btn primary" to="/evaluate">
              {t('dashboard.enterScores')}
            </Link>
          </div>
        )}
      </div>

      <SessionAlertsCard />

      <details className="panel">
        <summary>{t('dashboard.optionsTitle')}</summary>
        <p className="hint">{t('dashboard.optionsHint')}</p>
        <div className="toolbar">
          <GroupFilter
            value={groupId}
            onChange={(value) => persist({ groupId: value || null, assignmentId: null, seq: null })}
          />
          <label className="field">
            <span>{t('dashboard.assignmentLabel')}</span>
            <select
              value={assignmentId ?? ''}
              onChange={(event) =>
                persist({ assignmentId: event.target.value || null, seq: null })
              }
            >
              {scopedAssignments.map((assignment) => (
                <option key={assignment.id} value={assignment.id}>
                  {assignment.name ?? assignment.code}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('dashboard.periodLabel')}</span>
            <select
              value={seq ?? ''}
              onChange={(event) => persist({ seq: Number(event.target.value) })}
              disabled={periods.length === 0}
            >
              {[...periods].reverse().map((period) => (
                <option key={period.id} value={period.seq}>
                  {t('dashboard.periodOption', {
                    seq: period.seq,
                    answered: period.answeredCount ?? 0,
                  })}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented" role="group" aria-label={t('dashboard.dimensionLabel')}>
            {DIMENSIONS.map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="dashboard-dimension"
                  value={value}
                  checked={dimension === value}
                  onChange={() => persist({ dimension: value })}
                />
                {t(`results.${value}`)}
              </label>
            ))}
          </div>
          <div className="segmented" role="group" aria-label={t('dashboard.basisLabel')}>
            {BASES.map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="dashboard-basis"
                  value={value}
                  checked={basis === value}
                  onChange={() => persist({ basis: value })}
                />
                {t(`dashboard.${value}`)}
              </label>
            ))}
          </div>
          <div className="segmented" role="group" aria-label={t('dashboard.viewModeLabel')}>
            {['auto', '3d', '2d'].map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="dashboard-view-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => persist({ mode: value })}
                />
                {t(`dashboard.viewMode.${value}`)}
              </label>
            ))}
          </div>
          {mode !== '2d' && (
            <label className="inline">
              <input
                type="checkbox"
                checked={autoRotate}
                onChange={(event) => persist({ autoRotate: event.target.checked })}
              />
              {t('dashboard.autoRotate')}
            </label>
          )}
        </div>
      </details>

      {resultsQuery.isPending && (
        <p className="hint">{t('common:status.loading')}</p>
      )}
      {resultsQuery.isError && (
        <p className="error">{errorMessage(resultsQuery.error)}</p>
      )}

      {results && (
        <>
          <p className="summary-line">
            {t('dashboard.periodLine', {
              assignment: results.assignment.name ?? results.assignment.code,
              seq: results.period.seq,
              start: formatIsoDate(results.period.startDate),
              end: formatIsoDate(results.period.endDate),
            })}
          </p>

          {results.rows.length === 0 ? (
            <EmptyState
              title={t('dashboard.noStudentsTitle')}
              description={t('dashboard.noStudentsHint')}
            >
              {can('students.create') && (
                <p>
                  <Link to="/students">{t('dashboard.goToStudents')}</Link>
                </p>
              )}
            </EmptyState>
          ) : stats.every((stat) => !stat.parameter.inUse) ? (
            <EmptyState
              title={t('dashboard.nothingMeasuredTitle')}
              description={t('dashboard.nothingMeasuredHint')}
            />
          ) : (
            <>
              <CohortHero
                summary={summary}
                field={cohort}
                stats={stats}
                onSelect={setOpenTarget}
                mode={mode}
                autoRotate={autoRotate}
              />

              <section>
                <h2>{t('dashboard.needsScoring')}</h2>
                <UnmeasuredList items={unmeasured} />
              </section>
            </>
          )}
        </>
      )}

      <ParameterDrawer
        open={openTarget?.type === 'parameter' && Boolean(openStat)}
        stat={openStat}
        trend={openTrend}
        trendError={
          trendsQuery.isError ? errorMessage(trendsQuery.error) : null
        }
        onClose={closeDrawer}
      />
      <StudentDrawer
        open={openTarget?.type === 'student' && Boolean(openStudent)}
        breakdown={openStudent}
        onClose={closeDrawer}
      />
      <CohortDrawer
        open={openTarget?.type === 'cohort' && Boolean(openCohort)}
        summary={openCohort}
        onClose={closeDrawer}
      />
    </main>
  );
}

export default DashboardPage;
