import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  formatChange,
  formatParameterHint,
  formatStudentCode,
} from '../lib/format.js';
import { changeOf, valueOf } from '../lib/resultsView.js';

function SortHeader({ label, sortKey, sort, onSort, className }) {
  const active = sort.key === sortKey;
  const ariaSort = active
    ? sort.direction === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none';
  return (
    <th className={className} aria-sort={ariaSort}>
      <button type="button" className="sort" onClick={() => onSort(sortKey)}>
        {label}
        {active ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
}

// The assignment-period grid: one row per target (the whole-group row first),
// one column per chosen parameter showing the viewed dimension's value plus
// the change vs the previous period.
function ResultsTable({
  rows,
  columns,
  stats,
  sort,
  onSort,
  showChange,
  dimension,
  hasPrevious,
}) {
  const { t } = useTranslation(['reports', 'common']);
  const withChange = showChange && hasPrevious;

  return (
    <div className="table-wrap">
      <table className="results-table">
        <thead>
          <tr>
            <SortHeader
              label={t('resultsTable.studentCol')}
              sortKey="name"
              sort={sort}
              onSort={onSort}
            />
            <SortHeader
              label={t('common:table.code')}
              sortKey="code"
              sort={sort}
              onSort={onSort}
            />
            {columns.map((parameter) => (
              <SortHeader
                key={parameter.id}
                className="num"
                sortKey={parameter.id}
                sort={sort}
                onSort={onSort}
                label={
                  <>
                    {parameter.name}
                    <span className="hint">
                      {' '}
                      {formatParameterHint(parameter)}
                    </span>
                  </>
                }
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const name = row.isGroup ? (
              row.fullName
            ) : (
              <Link to={`/students/${row.studentId}`}>{row.fullName}</Link>
            );
            return (
              <tr key={row.membershipId ?? 'group'} className={row.isGroup ? 'group-row' : undefined}>
                <td>
                  {name}
                  {row.isGroup && (
                    <div className="hint">{t('resultsTable.groupRow')}</div>
                  )}
                </td>
                <td className="code">
                  {row.studentCode === null
                    ? '—'
                    : formatStudentCode(row.studentCode)}
                </td>
                {columns.map((parameter) => {
                  const value = valueOf(row, parameter.id, dimension);
                  const change = withChange
                    ? changeOf(row, parameter.id, dimension)
                    : null;
                  return (
                    <td key={parameter.id} className="num">
                      {value === undefined ? (
                        <span className="muted">—</span>
                      ) : value === null ? (
                        <span className="muted">·</span>
                      ) : (
                        value
                      )}
                      {change !== null && (
                        <span
                          className={`chg${
                            change > 0 ? ' up' : change < 0 ? ' down' : ''
                          }`}
                        >
                          {formatChange(change)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={2} scope="row">
              {t('resultsTable.average')}
            </th>
            {columns.map((parameter) => (
              <td key={parameter.id} className="num">
                {stats[parameter.id]?.average ?? '—'}
              </td>
            ))}
          </tr>
          <tr>
            <th colSpan={2} scope="row">
              {t('resultsTable.measured')}
            </th>
            {columns.map((parameter) => (
              <td key={parameter.id} className="num">
                {t('shared.of', {
                  a: stats[parameter.id]?.count ?? 0,
                  b: rows.length,
                })}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default ResultsTable;
