import { useCallback, useMemo, useReducer, useRef } from 'react';
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
import ExportScopePicker from '../components/ExportScopePicker.jsx';
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
function ExportPage() {
  const { t } = useTranslation(['reports', 'common']);
  const location = useLocation();

  const [config, dispatch] = useReducer(
    reducer,
    location.state?.export,
    (prefill) => mergePrefill(prefill)
  );

  const parametersQuery = useQuery({ queryKey: ['parameters'], queryFn: listParameters });
  const parameters = parametersQuery.data ?? EMPTY;

  // Resolve the scope to the concrete values api/export.js#fetchCube expects.
  // "All" with a pinned assignment still names that assignment so the cube
  // covers its whole calendar; unpinned "all" spans every assignment.
  const scope = useMemo(() => {
    const { assignmentId, mode, from, to, seqs } = config.scope;
    const resolved = {
      assignmentId,
      groupId: config.students.mode === 'group' ? config.students.groupId : null,
      studentIds: config.students.mode === 'selection' ? config.students.ids : [],
      parameterIds: config.parameters.mode === 'selection' ? config.parameters.ids : [],
    };
    if (mode === 'range') {
      resolved.from = from;
      resolved.to = to;
    }
    if (mode === 'selection') {
      resolved.periods = seqs;
    }
    return resolved;
  }, [config.scope, config.students, config.parameters]);

  const scopeReady =
    config.scope.mode !== 'range' ||
    (config.scope.from !== null && config.scope.to !== null);
  const seqsReady =
    config.scope.mode !== 'selection' ||
    (config.scope.assignmentId !== null && config.scope.seqs.length > 0);

  const cubeQuery = useQuery({
    queryKey: ['export-cube', scope],
    queryFn: () => fetchCube(scope),
    enabled: scopeReady && seqsReady,
  });
  const cube = useMemo(
    () =>
      cubeQuery.data
        ? buildCube({ ...cubeQuery.data, filters: config.filters, dimension: config.dimension })
        : null,
    [cubeQuery.data, config.filters, config.dimension]
  );

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
  const runDisabled = errors.length > 0 || !cube || auditLoading;
  const truncated = cubeQuery.data?.truncated;

  return (
    <main className="wide export-center">
      <h1>{t('export.title')}</h1>
      <p className="hint">{t('export.subtitle')}</p>

      <div className="export-layout">
        <div className="export-config">
          <ExportStudentPicker
            value={config.students}
            onChange={(students) => dispatch({ students })}
          />
          <ExportParameterPicker
            value={config.parameters}
            parameters={parameters}
            onChange={(next) => dispatch({ parameters: next })}
          />
          <ExportScopePicker
            value={config.scope}
            onChange={(scope) => dispatch({ scope })}
          />
          <section className="section-card">
            <h2 className="group-title">{t('export.dimensionTitle')}</h2>
            <div className="include-list">
              {['quality', 'quantity'].map((value) => (
                <label key={value} className="inline include-item">
                  <input
                    type="radio"
                    name="export-dimension"
                    value={value}
                    checked={config.dimension === value}
                    onChange={() => dispatch({ dimension: value })}
                  />
                  <span>{t(`results.${value}`)}</span>
                </label>
              ))}
            </div>
          </section>
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
            parameters={parameters}
            periodOptions={cube?.periods ?? EMPTY}
            onChange={(charts) => dispatch({ charts })}
          />
        </div>

        <div className="export-output">
          <div className="export-run-bar">
            <ExportRunButton
              config={config}
              cube={cube}
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
          {scopeReady && seqsReady && cubeQuery.isPending && (
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
              <ExportPreview config={config} cube={cube} registerChart={registerChart} />
            ) : (
              <p className="hint">{t('export.chooseSomething')}</p>
            ))}
        </div>
      </div>
    </main>
  );
}

export default ExportPage;
