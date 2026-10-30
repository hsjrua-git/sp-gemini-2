import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { listStudentEvaluations } from '../api/evaluations.js';
import { listParameters } from '../api/parameters.js';
import { getStudent } from '../api/students.js';
import { listAssignments } from '../api/schedule.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import ByParameterView from '../components/ByParameterView.jsx';
import ByPeriodView from '../components/ByPeriodView.jsx';
import EmptyState from '../components/EmptyState.jsx';
import HistoryGrid from '../components/HistoryGrid.jsx';
import { formatStudentCode } from '../lib/format.js';
import ReportScopePicker from '../components/ReportScopePicker.jsx';
import { useReportScope } from '../lib/useReportScope.js';
import { scopedHistory } from '../lib/reportResults.js';
import { visibleParameters } from '../lib/prefs.js';
import { usePreferences } from '../preferences/PreferencesContext.jsx';
import ExportButton from '../components/ExportButton.jsx';
import ExportLink from '../components/ExportLink.jsx';
import StudentFieldsSection from '../components/StudentFieldsSection.jsx';
import StudentGroupsSection from '../components/StudentGroupsSection.jsx';
import StudentIdentitySection from '../components/StudentIdentitySection.jsx';
import StudentBalanceSection from '../components/StudentBalanceSection.jsx';
import { historyCsvRows } from '../lib/exports.js';

// Tab ids double as the stored preference value ('overview' / 'period' /
// 'parameter' in lib/preferences defaults) — translate only the label.
const TABS = [
  { id: 'overview', labelKey: 'detail.tabOverview' },
  { id: 'period', labelKey: 'detail.tabByPeriod' },
  { id: 'parameter', labelKey: 'detail.tabByParameter' },
];

function StudentDetailPage() {
  const { t } = useTranslation(['students', 'common']);
  const { id } = useParams();
  const { can } = useAuth();
  const { preferences } = usePreferences();
  const [tab, setTab] = useState(preferences.studentDefaultTab);

  // The score history (all three tabs, plus the CSV export) is evaluations
  // labelled by parameters, so it needs BOTH scores.view and parameters.view.
  // A role that can see students but lacks one of those still gets the
  // student's identity, custom fields and group memberships below — only the
  // History section is hidden, rather than erroring the whole page. This is
  // why the students list can safely link every name: the detail page always
  // renders whatever the role is allowed to see.
  const canViewScores = can('scores.view');
  const canViewParameters = can('parameters.view');
  const canViewHistory = canViewScores && canViewParameters;
  const report = useReportScope({ enabled: canViewHistory });

  const studentQuery = useQuery({
    queryKey: ['student', id],
    queryFn: () => getStudent(id),
  });
  const evaluationsQuery = useQuery({
    queryKey: ['evaluations', { studentId: id }],
    queryFn: () => listStudentEvaluations(id),
    enabled: canViewScores,
  });
  const parametersQuery = useQuery({
    queryKey: ['parameters'],
    queryFn: listParameters,
    enabled: canViewParameters,
  });
  const assignmentsQuery = useQuery({
    queryKey: ['assignments'],
    queryFn: listAssignments,
    enabled: canViewHistory,
  });
  const assignmentsById = useMemo(
    () =>
      new Map(
        (assignmentsQuery.data ?? []).map((assignment) => [assignment.id, assignment])
      ),
    [assignmentsQuery.data]
  );

  const backLink = (
    <p>
      <Link to="/students">{t('detail.back')}</Link>
    </p>
  );

  if (studentQuery.isError && studentQuery.error.status === 404) {
    return (
      <main>
        {backLink}
        <EmptyState
          tone="warn"
          title={t('detail.notFoundTitle')}
          description={t('detail.notFoundDescription')}
        />
      </main>
    );
  }

  // Only the queries we actually fire gate the page. A query disabled by a
  // missing permission stays `pending` forever (its fetch never starts), so
  // including it here would wedge the page on "Loading..." — instead its
  // dependent section is simply hidden below.
  const queries = [studentQuery];
  if (canViewScores) queries.push(evaluationsQuery);
  if (canViewParameters) queries.push(parametersQuery);
  if (canViewHistory) queries.push(assignmentsQuery, { isPending: report.isPending, isError: Boolean(report.error), error: report.error });
  const failed = queries.find((query) => query.isError);
  if (failed) {
    return (
      <main>
        {backLink}
        <EmptyState
          tone="danger"
          title={t('detail.loadErrorTitle')}
          description={errorMessage(failed.error)}
        />
      </main>
    );
  }
  if (queries.some((query) => query.isPending)) {
    return (
      <main aria-busy="true">
        {backLink}
        <div className="page-loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <p>{t('common:status.loading')}</p>
        </div>
      </main>
    );
  }

  const student = studentQuery.data;
  const evaluations = canViewHistory ? scopedHistory(evaluationsQuery.data ?? [], report.selectedPeriods) : [];
  const parameters = parametersQuery.data;

  let content = null;
  if (canViewHistory) {
    const shown = visibleParameters(parameters, preferences.hiddenParameterIds);
    const viewProps = { evaluations, parameters: shown };
    if (evaluations.length === 0) {
      content = <p>{t('detail.noCellsYet')}</p>;
    } else if (tab === 'period') {
      content = (
        report.scope.dimensions.map(dimension => <section key={dimension}>
          <h3>{t(`workflows:scope.${dimension}`)}</h3>
          <ByPeriodView {...viewProps} dimension={dimension} assignmentsById={assignmentsById}
            selectedPeriods={report.selectedPeriods} comparisonEvaluations={evaluationsQuery.data} />
        </section>)
      );
    } else if (tab === 'parameter') {
      content = report.scope.dimensions.map(dimension => <section key={dimension}>
        <h3>{t(`workflows:scope.${dimension}`)}</h3><ByParameterView {...viewProps} dimension={dimension} />
      </section>);
    } else {
      content = (
        <>
          <HistoryGrid
            evaluations={evaluations}
            parameters={shown}
            assignmentsById={assignmentsById}
            initialShowAll={preferences.studentShowAllPeriods}
            dimensions={report.scope.dimensions}
          />
          {shown.length < parameters.length && (
            <p className="hint">
              <Trans
                t={t}
                i18nKey="detail.hiddenParameters"
                components={{ link: <Link to="/preferences" /> }}
              />
            </p>
          )}
        </>
      );
    }
  }

  return (
    <main className="wide">
      {backLink}
      <div className="page-head">
        <div>
          <h1>{student.fullName}</h1>
          <p className="hint code">
            {t('detail.code', { code: formatStudentCode(student.studentCode) })}
          </p>
        </div>
        {can('data.export') && (
          <div className="page-head-actions">
            {canViewHistory && (
              <ExportButton
                label={t('detail.exportHistory')}
                filename={`history-${student.studentCode}.csv`}
                disabled={!evaluations || evaluations.length === 0}
                buildRows={() =>
                  historyCsvRows({
                    evaluations,
                    parameters,
                     assignmentsById,
                     dimensions: report.scope.dimensions,
                  })
                }
              />
            )}
            <ExportLink
              prefill={{ students: { mode: 'selection', ids: [student.id] } }}
            />
          </div>
        )}
      </div>

      <StudentIdentitySection student={student} />
      <StudentFieldsSection student={student} />
      <StudentGroupsSection student={student} />
      {can('cafe.balance') && <StudentBalanceSection student={student} />}

      {canViewHistory && (
        <section className="section-card">
          <div className="page-head">
            <h2>{t('detail.history')}</h2>
          </div>
          <ReportScopePicker report={report} />
          <div className="tabs" role="tablist" aria-label={t('detail.historyViews')}>
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? 'tab active' : 'tab'}
                onClick={() => setTab(item.id)}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
          {content}
        </section>
      )}
    </main>
  );
}

export default StudentDetailPage;
