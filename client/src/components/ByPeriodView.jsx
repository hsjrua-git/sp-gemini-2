import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getPeriods } from '../api/periods.js';
import { formatChange } from '../lib/format.js';
import { periodView } from '../lib/views.js';

function Meter({ percent }) {
  if (percent === null) return null;
  return (
    <div className="meter" aria-hidden="true">
      <div className="meter-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

// "By assignment period": pick one of the student's assignments, then one of
// its periods; each row is a parameter the student has a cell for somewhere
// in that assignment, showing the viewed dimension's value (their own member
// cell, else the whole-group cell — marked), the range meter and the change
// vs the previous period.
function ByPeriodView({ evaluations, parameters, assignmentsById, dimension }) {
  const { t } = useTranslation(['reports', 'common']);

  const assignmentIds = [...new Set(evaluations.map((item) => item.assignmentId))];
  const [assignmentId, setAssignmentId] = useState(assignmentIds[0] ?? null);

  const periodsQuery = useQuery({
    queryKey: ['periods', assignmentId],
    queryFn: () => getPeriods(assignmentId),
    enabled: assignmentId !== null,
  });
  const periods = (periodsQuery.data ?? []).filter(
    (period) => period.sessionCount > 0
  );
  const latestSeq = periods[periods.length - 1]?.seq ?? null;
  const [chosenSeq, setChosenSeq] = useState(null);
  const seq = chosenSeq ?? latestSeq;
  const period = periods.find((item) => item.seq === seq) ?? null;

  const rows =
    assignmentId !== null && period !== null
      ? periodView({
          evaluations,
          assignmentId,
          seq,
          parameters,
          dimension,
        })
      : [];

  return (
    <>
      <div className="toolbar">
        <label className="field">
          <span>{t('byPeriod.assignment')}</span>
          <select
            value={assignmentId ?? ''}
            onChange={(event) => {
              setAssignmentId(event.target.value || null);
              setChosenSeq(null);
            }}
          >
            {assignmentIds.map((id) => (
              <option key={id} value={id}>
                {assignmentsById.get(id)?.name ?? assignmentsById.get(id)?.code ?? id}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('byPeriod.period')}</span>
          <select
            value={seq ?? ''}
            onChange={(event) => setChosenSeq(Number(event.target.value))}
            disabled={periods.length === 0}
          >
            {[...periods].reverse().map((item) => (
              <option key={item.id} value={item.seq}>
                {t('byPeriod.periodOption', { seq: item.seq })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {periodsQuery.isPending && <p className="hint">{t('common:status.loading')}</p>}
      {rows.length === 0 && !periodsQuery.isPending ? (
        <p>{t('byPeriod.empty', { seq: seq ?? '…' })}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('shared.parameter')}</th>
                <th className="num">{t('shared.score')}</th>
                <th>{t('byPeriod.withinRange')}</th>
                <th className="num">{t('byPeriod.changeVsPrevious')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.parameter.id}>
                  <td>{row.parameter.name}</td>
                  <td className="num">
                    {row.value === null ? (
                      <span className="muted" title={t('history.selectedNotAnswered')}>
                        ·
                      </span>
                    ) : (
                      row.value
                    )}
                    {row.viaGroup && (
                      <span className="hint" title={t('history.viaGroup')}>
                        *
                      </span>
                    )}
                  </td>
                  <td>
                    <Meter percent={row.percent} />
                  </td>
                  <td className="num">{formatChange(row.change)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default ByPeriodView;
