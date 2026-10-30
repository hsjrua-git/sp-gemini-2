import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatParameterHint, formatShortIsoDate } from '../lib/format.js';
import { buildHistory, visibleRows } from '../lib/history.js';

// One timeline cell: the student's two dimensions for that session ×
// parameter. A member cell shadows the group cell; a group-sourced value is
// marked. Selected-but-unanswered cells read as a small dot.
function Cell({ cell, dimensions }) {
  const { t } = useTranslation(['reports', 'common']);
  if (cell.state === 'none') {
    return (
      <td className="num na" title={t('history.notSelected')}>
        —
      </td>
    );
  }
  if (!cell.answered) {
    return (
      <td className="num muted" title={t('history.selectedNotAnswered')}>
        ·
      </td>
    );
  }
  const value = dimensions
    .map(dimension => (cell[dimension] === null ? '·' : `${cell[dimension]}${dimension === 'quality' ? '%' : ''}`))
    .join(' / ');
  const comment = dimensions.map(dimension => cell[`${dimension}Comment`])
    .filter(Boolean)
    .join(' — ');
  return (
    <td
      className="num"
      title={`${cell.viaGroup ? t('history.viaGroup') + ' · ' : ''}${comment}`}
    >
      {value}
      {cell.viaGroup && <span className="hint">*</span>}
    </td>
  );
}

// The overview tab: the student's evaluation timeline by session date.
function HistoryGrid({ evaluations, parameters, assignmentsById, initialShowAll = false, dimensions = ['quality', 'quantity'] }) {
  const { t } = useTranslation(['reports', 'common']);
  const [showAll, setShowAll] = useState(initialShowAll);

  const history = useMemo(
    () => buildHistory({ evaluations, parameters }),
    [evaluations, parameters]
  );
  const rows = useMemo(
    () => [...visibleRows(history.rows, showAll)].reverse(),
    [history.rows, showAll]
  );

  if (history.columns.length === 0) {
    return <p>{t('shared.noParametersYet')}</p>;
  }
  if (rows.length === 0) return <p>{t('history.noSessions')}</p>;

  return (
    <>
      <label className="inline">
        <input
          type="checkbox"
          checked={showAll}
          onChange={(event) => setShowAll(event.target.checked)}
        />
        {t('history.showAll')}
      </label>
      <p className="hint">{dimensions.map(dimension => t(`workflows:scope.${dimension}`)).join(' / ')} · {t('history.legend')}</p>

      <div className="table-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>{t('history.sessionCol')}</th>
              {history.columns.map((parameter) => (
                <th key={parameter.id} className="num">
                  <span title={parameter.path}>{parameter.depth > 0 && '↳ '}{parameter.name}</span>
                  <div className="hint">{formatParameterHint(parameter, dimensions.length === 2 ? 'both' : dimensions[0])}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sessionId}>
                <th scope="row">
                  {formatShortIsoDate(row.sessionDate)}
                  <div className="hint">
                    {assignmentsById.get(row.assignmentId)?.name ??
                      assignmentsById.get(row.assignmentId)?.code ??
                      row.sessionCode}
                  </div>
                </th>
                {history.columns.map((parameter) => (
                  <Cell key={parameter.id} cell={row.cells[parameter.id]} dimensions={dimensions} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default HistoryGrid;
