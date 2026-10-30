import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { listParameters } from '../api/parameters.js';
import { fetchAuditTrail } from '../api/audit.js';
import { fetchCube } from '../api/export.js';
import { buildCube } from '../lib/cube.js';
import {
  exportConfigErrors,
  includesTabular,
  mergePrefill,
} from '../lib/exportConfig.js';
import { errorMessage } from '../i18n/errors.js';
import FilterEditor from '../components/FilterEditor.jsx';
import ExportStudentPicker from '../components/ExportStudentPicker.jsx';
import ExportParameterPicker from '../components/ExportParameterPicker.jsx';
import ReportScopePicker from '../components/ReportScopePicker.jsx';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import { useReportScope } from '../lib/useReportScope.js';
import { hierarchy } from '../lib/hierarchy.js';
import { exportReportScope } from '../lib/reportPrefill.js';
import IncludePicker from '../components/IncludePicker.jsx';
import FormatPicker from '../components/FormatPicker.jsx';
import ChartConfigPanel from '../components/ChartConfigPanel.jsx';
import ExportPreview from '../components/ExportPreview.jsx';
import ExportRunButton from '../components/ExportRunButton.jsx';

const EMPTY = [];

// The whole config lives in one object; every picker hands back a full slice (or,
// for the format picker, a small patch), so a shallow merge is all the reducer
// needs. Shape, defaults and validation live in lib/exportConfig.js.
function reducer(state, patch) {
  return { ...state, ...patch };
}

// The Export Center: one scope (students × parameters × assignment-periods or
// a session-date range), one dimension, filters, and any mix of tabular data,
// deltas, the audit trail and charts — all cut from the /api/export/cube.
function ExportPage({ prefill }) {
  const { t } = useTranslation(['reports', 'common']);
  const report = useReportScope();
  const legacy = prefill?.students?.mode === 'group' || prefill?.scope?.assignmentId || prefill?.dimension;
  const [prefillApplied, setPrefillApplied] = useState(!legacy);
  const applyingPrefill = useRef(false);
  const resolvedPrefill = useMemo(() => exportReportScope(prefill, report.scope, report.periods), [prefill, report.scope, report.periods]);
  useEffect(() => {
    if (prefillApplied || applyingPrefill.current || report.isPending || report.error || !resolvedPrefill) return;
    applyingPrefill.current = true;
    report.change(resolvedPrefill, { onSuccess: () => setPrefillApplied(true) });
  }, [prefillApplied, report, resolvedPrefill]);

  const [config, dispatch] = useReducer(
    reducer,
    prefill,
    (prefill) => ({ ...mergePrefill(prefill), students: prefill?.students?.mode === 'group' ? { mode: 'all', ids: [] } : mergePrefill(prefill).students,
      search: typeof prefill?.search === 'string' ? prefill.search : '' })
  );

  const parametersQuery = useQuery({ queryKey: ['parameters'], queryFn: listParameters });
  const parameters = parametersQuery.data ?? EMPTY;

  // Resolve the scope to the concrete values api/export.js#fetchCube expects.
  // "All" with a pinned assignment still names that assignment so the cube
  // covers its whole calendar; unpinned "all" spans every assignment.
  const scope = useMemo(() => {
    const { mode, from, to } = config.scope;
    const resolved = {
      periodIds: report.selectedPeriods.map(p => p.id),
      studentIds: config.students.mode === 'selection' ? config.students.ids : [],
      parameterIds: config.parameters.mode === 'selection' ? [...new Set([...config.parameters.ids, ...config.filters.map(f => f.parameterId)])] : [],
    };
    if (mode === 'range') {
      resolved.from = from;
      resolved.to = to;
    }
    return resolved;
  }, [config.scope, config.students, config.parameters, config.filters, report.selectedPeriods]);

  const scopeReady =
    config.scope.mode !== 'range' ||
    Boolean(config.scope.from && config.scope.to && config.scope.from <= config.scope.to);
  const seqsReady = !report.isPending && report.selectedPeriods.length > 0 && report.selectedPeriods.length <= 200;

  const cubeQuery = useQuery({
    queryKey: ['export-cube', scope],
    queryFn: () => fetchCube(scope),
    enabled: prefillApplied && scopeReady && seqsReady && !report.error,
  });
  const cubes = useMemo(
    () =>
      cubeQuery.data
        ? report.scope.dimensions.map(dimension => buildCube({ ...cubeQuery.data,
          students: cubeQuery.data.students.filter(s => !config.search.trim() || `${s.fullName} ${s.studentCode}`.toLowerCase().includes(config.search.trim().toLowerCase())),
          parameters: hierarchy(cubeQuery.data.parameters).filter(p => config.parameters.mode !== 'selection' || config.parameters.ids.includes(p.id)), filters: config.filters, dimension }))
        : [],
    [cubeQuery.data, config.filters, config.parameters, config.search, report.scope.dimensions]
  );
  const cube = cubes[0] ?? null;

  // The audit trail, fetched only when its content type is selected.
  const auditQuery = useQuery({
    queryKey: ['audit-trail'],
    queryFn: () => fetchAuditTrail({}),
    enabled: config.include.auditTrail,
  });

  // Each chart registers its rendered container so the run can read its <svg>.
  const chartNodes = useRef(new Map());
  const registerChart = useCallback((index, node) => {
    if (node) chartNodes.current.set(index, node);
    else chartNodes.current.delete(index);
  }, []);

  const errors = exportConfigErrors(config);
  const auditLoading = config.include.auditTrail && auditQuery.isPending;
  const runDisabled = !prefillApplied || errors.length > 0 || !cube || auditLoading || !scopeReady || !seqsReady || Boolean(report.error || cubeQuery.error || auditQuery.error);
  const truncated = cubeQuery.data?.truncated;

  return (
    <main className="wide export-center">
      <h1>{t('export.title')}</h1>
      <p className="hint">{t('export.subtitle')}</p>
      <ReportScopePicker report={{ ...report, change: changes => { setPrefillApplied(true); report.change(changes); } }} />
      {!prefillApplied && !report.isPending && !resolvedPrefill && <p role="alert" className="error">{t('workflows:scopeUnavailable')}</p>}
      {report.error && <p className="error">{errorMessage(report.error)}</p>}

      <div className="export-layout">
        <div className="export-config">
          <label>{t('results.searchLabel')}<input type="search" value={config.search} onChange={event => dispatch({ search: event.target.value })} /></label>
          <ExportStudentPicker
            allowGroup={false}
            value={config.students}
            onChange={(students) => dispatch({ students })}
          />
          <ExportParameterPicker
            value={config.parameters}
            parameters={parameters}
            onChange={(next) => dispatch({ parameters: next })}
          />
          <fieldset><legend>{t('scopePicker.legend')}</legend>
            <label className="inline"><input type="checkbox" checked={config.scope.mode === 'range'} onChange={event => dispatch({ scope: { ...config.scope, mode: event.target.checked ? 'range' : 'all' } })} />{t('scopePicker.rangeLabel')}</label>
            {config.scope.mode === 'range' && <>
              <label>{t('scopePicker.from')}<JalaliDatePicker value={config.scope.from ?? ''} onChange={from => dispatch({ scope: { ...config.scope, from } })} /></label>
              <label>{t('scopePicker.to')}<JalaliDatePicker value={config.scope.to ?? ''} onChange={to => dispatch({ scope: { ...config.scope, to } })} /></label>
            </>}
          </fieldset>
          <section className="section-card">
            <h2 className="group-title">{t('filter.title')}</h2>
            <FilterEditor
              filters={config.filters}
              parameters={parameters}
              onChange={(filters) => dispatch({ filters })}
            />
          </section>
          <IncludePicker
            value={config.include}
            onChange={(include) => dispatch({ include })}
          />
          <FormatPicker
            format={config.tabularFormat}
            layout={config.layout}
            showLayout={config.include.data}
            onChange={(patch) => dispatch(patch)}
          />
          <ChartConfigPanel
            value={config.charts}
            parameters={cube?.parameters ?? parameters}
            periodOptions={cube?.periods ?? EMPTY}
            onChange={(charts) => dispatch({ charts })}
          />
        </div>

        <div className="export-output">
          <div className="export-run-bar">
            <ExportRunButton
              config={config}
              cube={cube}
              cubes={cubes}
              scope={scope}
              auditEntries={auditQuery.data?.entries ?? EMPTY}
              chartNodes={chartNodes}
              disabled={runDisabled}
            />
            {errors.length > 0 && (
              <ul className="export-errors">
                {errors.map((message) => (
                  <li key={message} className="hint">
                    {message}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!scopeReady && <p className="hint">{t('export.pickDates')}</p>}
          {!seqsReady && <p className="hint">{t('export.pickPeriods')}</p>}
          {prefillApplied && scopeReady && seqsReady && cubeQuery.isPending && (
            <p className="hint">{t('export.loadingData')}</p>
          )}
          {cubeQuery.isError && (
            <p className="error">{errorMessage(cubeQuery.error)}</p>
          )}
          {auditLoading && <p className="hint">{t('export.loadingChanges')}</p>}
          {truncated && (
            <p className="hint">
              {t('export.truncated', {
                count: cubeQuery.data.students.length,
              })}
            </p>
          )}

          {cube &&
            (includesTabular(config) || config.charts.length > 0 ? (
              cubes.map(item => <section key={item.dimension}><h2>{t(`workflows:scope.${item.dimension}`)}</h2>
                <ExportPreview config={config} cube={item} registerChart={(index, node) => registerChart(`${item.dimension}:${index}`, node)} />
              </section>)
            ) : (
              <p className="hint">{t('export.chooseSomething')}</p>
            ))}
        </div>
      </div>
    </main>
  );
}

export default function ExportEntry() {
  const location = useLocation();
  return <ExportPage key={location.key} prefill={location.state?.export} />;
}
