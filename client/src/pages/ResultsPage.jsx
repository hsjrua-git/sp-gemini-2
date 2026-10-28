import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getResults } from '../api/results.js';
import { getPeriods } from '../api/periods.js';
import { listAssignments } from '../api/schedule.js';
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from '../api/savedViews.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import EmptyState from '../components/EmptyState.jsx';
import FilterEditor from '../components/FilterEditor.jsx';
import ResultsTable from '../components/ResultsTable.jsx';
import SavedViewsBar from '../components/SavedViewsBar.jsx';
import { formatIsoDate } from '../lib/format.js';
import {
  applyView,
  defaultConfig,
  describeFilter,
  DIMENSIONS,
  normalizeConfig,
  sameConfig,
  toggleColumn,
  toggleSort,
  withFilterKeys,
} from '../lib/resultsView.js';
import ExportButton from '../components/ExportButton.jsx';
import { resultsCsvRows } from '../lib/exports.js';

const EMPTY = [];

// The assignment-period results grid. The picker chain is assignment →
// period (a saved view may pin both) → dimension toggle; filters, columns,
// sort, search and the change column work on the viewed dimension.
function ResultsPage() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['reports', 'common']);
  const { can } = useAuth();

  const [config, setConfig] = useState(() => withFilterKeys(defaultConfig()));
  const [activeView, setActiveView] = useState(null);

  const assignmentsQuery = useQuery({
    queryKey: ['assignments'],
    queryFn: listAssignments,
  });
  const assignments = assignmentsQuery.data ?? EMPTY;

  // The assignment the grid shows: a saved view's pinned one, else the first.
  const assignmentId = config.assignmentId ?? assignments[0]?.id ?? null;

  const periodsQuery = useQuery({
    queryKey: ['periods', assignmentId],
    queryFn: () => getPeriods(assignmentId),
    enabled: assignmentId !== null,
  });
  const periods = useMemo(
    () => (periodsQuery.data ?? []).filter((period) => period.sessionCount > 0),
    [periodsQuery.data]
  );

  // The period the grid shows: a pinned seq, else the latest one with sessions.
  const seq = config.seq ?? periods[periods.length - 1]?.seq ?? null;
  const dimension = DIMENSIONS.includes(config.dimension)
    ? config.dimension
    : 'quality';

  const resultsQuery = useQuery({
    queryKey: ['results', { assignmentId, seq, dimension }],
    queryFn: () => getResults({ assignmentId, seq, dimension }),
    enabled: assignmentId !== null && seq !== null,
  });
  const viewsQuery = useQuery({
    queryKey: ['saved-views'],
    queryFn: listSavedViews,
  });

  function refreshViews() {
    queryClient.invalidateQueries({ queryKey: ['saved-views'] });
  }

  const create = useMutation({
    mutationFn: createSavedView,
    onSuccess: (view) => {
      setActiveView(view);
      refreshViews();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, fields }) => updateSavedView(id, fields),
    onSuccess: (view) => {
      setActiveView(view);
      refreshViews();
    },
  });
  const remove = useMutation({
    mutationFn: deleteSavedView,
    onSuccess: () => {
      setActiveView(null);
      refreshViews();
    },
  });

  const busy = create.isPending || update.isPending || remove.isPending;
  const actionError =
    errorMessage(create.error) ||
    errorMessage(update.error) ||
    errorMessage(remove.error) ||
    null;

  function resetErrors() {
    create.reset();
    update.reset();
    remove.reset();
  }

  const parameters = resultsQuery.data?.parameters ?? EMPTY;
  const rows = resultsQuery.data?.rows ?? EMPTY;
  const parametersById = useMemo(
    () => new Map(parameters.map((parameter) => [parameter.id, parameter])),
    [parameters]
  );
  const view = useMemo(
    () => applyView({ rows, parameters, config }),
    [rows, parameters, config]
  );

  const chosenColumns =
    config.parameterIds.length === 0
      ? parameters
      : parameters.filter((parameter) => config.parameterIds.includes(parameter.id));
  const columns = chosenColumns.length > 0 ? chosenColumns : parameters;
  const allIds = parameters.map((parameter) => parameter.id);
  const dirty = activeView !== null && !sameConfig(config, activeView.config);

  function patch(changes) {
    setConfig((existing) => ({ ...existing, ...changes }));
  }

  function handleAssignmentChange(id) {
    // Switching assignments drops the pinned period (seqs are per assignment).
    patch({ assignmentId: id || null, seq: null });
  }

  function handlePeriodChange(event) {
    const value = event.target.value;
    patch({ seq: value === '' ? null : Number(value) });
  }

  function handleLoad(id) {
    resetErrors();
    if (!id) {
      setActiveView(null);
      return;
    }
    const found = viewsQuery.data?.find((item) => item.id === id);
    if (!found) return;
    setConfig(withFilterKeys(normalizeConfig(found.config)));
    setActiveView(found);
  }

  function handleSaveAs() {
    const name = window.prompt(t('results.promptName'));
    if (name === null || name.trim() === '') return;
    resetErrors();
    create.mutate({ name, config: normalizeConfig(config) });
  }

  function handleUpdate() {
    resetErrors();
    update.mutate({
      id: activeView.id,
      fields: { config: normalizeConfig(config) },
    });
  }

  function handleRename() {
    const name = window.prompt(t('results.promptRename'), activeView.name);
    if (name === null || name.trim() === '') return;
    resetErrors();
    update.mutate({ id: activeView.id, fields: { name } });
  }

  function handleDelete() {
    if (!window.confirm(t('results.confirmDelete', { name: activeView.name })))
      return;
    resetErrors();
    remove.mutate(activeView.id);
  }

  function handleReset() {
    resetErrors();
    setConfig(withFilterKeys(defaultConfig()));
    setActiveView(null);
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
          title={t('results.errorTitle')}
          description={errorMessage(assignmentsQuery.error)}
        />
      </main>
    );
  }
  if (assignments.length === 0) {
    return (
      <main>
        <h1>{t('results.title')}</h1>
        <EmptyState
          title={t('results.noAssignments')}
          description={t('results.noAssignmentsHint')}
        >
          <p>
            <Link to="/schedule">{t('results.goToSchedule')}</Link>
          </p>
        </EmptyState>
      </main>
    );
  }

  const data = resultsQuery.data;
  const filterTexts = config.filters.map((filter) =>
    describeFilter(filter, parametersById)
  );
  const liveSeq = seq ?? periods[periods.length - 1]?.seq ?? null;

  return (
    <main className="wide results">
      <h1>{t('results.title')}</h1>
      <p className="hint">{t('results.subtitle')}</p>

      <div className="toolbar">
        <label className="field">
          <span>{t('results.assignmentLabel')}</span>
          <select
            value={assignmentId ?? ''}
            onChange={(event) => handleAssignmentChange(event.target.value)}
          >
            {assignments.map((assignment) => (
              <option key={assignment.id} value={assignment.id}>
                {assignment.name ?? assignment.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('results.periodLabel')}</span>
          <select
            value={liveSeq ?? ''}
            onChange={handlePeriodChange}
            disabled={periods.length === 0}
          >
            {periods.length === 0 && <option value="">—</option>}
            {[...periods].reverse().map((period) => (
              <option key={period.id} value={period.seq}>
                {t('results.periodOption', {
                  seq: period.seq,
                  answered: period.answeredCount ?? 0,
                })}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="group" aria-label={t('results.dimensionLabel')}>
          {DIMENSIONS.map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="results-dimension"
                value={value}
                checked={dimension === value}
                onChange={() => patch({ dimension: value })}
              />
              {t(`results.${value}`)}
            </label>
          ))}
        </div>
      </div>

      <SavedViewsBar
        views={viewsQuery.data ?? EMPTY}
        activeId={activeView?.id ?? null}
        dirty={dirty}
        busy={busy}
        error={actionError}
        onLoad={handleLoad}
        onSaveAs={handleSaveAs}
        onUpdate={handleUpdate}
        onRename={handleRename}
        onDelete={handleDelete}
        onReset={handleReset}
      />

      <div className="toolbar">
        <input
          type="search"
          className="search"
          value={config.search}
          onChange={(event) => patch({ search: event.target.value })}
          placeholder={t('results.searchPlaceholder')}
          aria-label={t('results.searchLabel')}
        />
        <label className="inline">
          <input
            type="checkbox"
            checked={config.showChange}
            onChange={(event) => patch({ showChange: event.target.checked })}
          />
          {t('results.showChange')}
        </label>
        {can('data.export') && (
          <ExportButton
            label={t('results.exportCsv')}
            filename={`results-${assignmentId}-period-${liveSeq}.csv`}
            disabled={!data || parameters.length === 0 || view.rows.length === 0}
            buildRows={() =>
              resultsCsvRows({
                period: data?.period,
                columns,
                rows: view.rows,
                dimension,
                showChange: config.showChange,
              })
            }
          />
        )}
      </div>

      {parameters.length > 0 && (
        <details className="panel">
          <summary>
            {t('results.columnsSummary', {
              chosen: columns.length,
              total: parameters.length,
            })}
          </summary>
          <div className="columns-list">
            {parameters.map((parameter) => (
              <label key={parameter.id} className="inline">
                <input
                  type="checkbox"
                  checked={columns.some((column) => column.id === parameter.id)}
                  onChange={(event) =>
                    patch({
                      parameterIds: toggleColumn(
                        config.parameterIds,
                        allIds,
                        parameter.id,
                        event.target.checked
                      ),
                    })
                  }
                />
                {parameter.name}
              </label>
            ))}
          </div>
        </details>
      )}

      <section className="section-card">
        <h2 className="group-title">{t('filter.title')}</h2>
        <FilterEditor
          filters={config.filters}
          parameters={parameters}
          onChange={(filters) => patch({ filters })}
        />
      </section>

      {resultsQuery.isPending && (
        <p className="hint">{t('common:status.loading')}</p>
      )}
      {resultsQuery.isError && (
        <p className="error">{errorMessage(resultsQuery.error)}</p>
      )}

      {data && (
        <section className="section-card">
          <p className="summary-line">
            {t('results.summaryLine', {
              assignment: data.assignment.name ?? data.assignment.code,
              seq: data.period.seq,
              start: formatIsoDate(data.period.startDate),
              end: formatIsoDate(data.period.endDate),
              shown: view.rows.length,
              total: rows.length,
            })}
          </p>
          {filterTexts.length > 0 && (
            <span className="chip-row">
              {filterTexts.map((text, index) => (
                <span
                  key={config.filters[index]?.key ?? index}
                  className="chip brand"
                >
                  {text}
                </span>
              ))}
            </span>
          )}
          {view.ignoredFilters > 0 && (
            <p className="hint">
              {t('results.ignoredFilters', { count: view.ignoredFilters })}
            </p>
          )}

          {parameters.length === 0 ? (
            <p>{t('results.noParameters')}</p>
          ) : view.rows.length === 0 ? (
            <p>
              {t('results.noMatch')}{' '}
              <button
                type="button"
                className="quiet"
                onClick={() => patch({ filters: [], search: '' })}
              >
                {t('results.clearFilters')}
              </button>
            </p>
          ) : (
            <ResultsTable
              rows={view.rows}
              columns={columns}
              stats={view.stats}
              sort={config.sort}
              onSort={(key) => patch({ sort: toggleSort(config.sort, key) })}
              showChange={config.showChange}
              dimension={dimension}
              hasPrevious={data.hasPrevious}
            />
          )}
        </section>
      )}
    </main>
  );
}

export default ResultsPage;
