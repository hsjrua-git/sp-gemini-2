import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listAudit } from '../api/audit.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { CATEGORY_OPTIONS, describeAudit } from '../lib/audit.js';
import { formatDateTime, formatStudentCode } from '../lib/format.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { errorMessage } from '../i18n/errors.js';

// Renders the action sentence from describeAudit's translation-ready
// segments: each resolves against admin:audit.actions.*, joined by the
// locale's joiner (', ' / '، '). The raw action code is the defaultValue, so
// an action the locale files do not know yet shows its code, never a key.
function ActionText({ entry }) {
  const { t } = useTranslation(['admin', 'common']);
  return describeAudit(entry).map((segment, index) => (
    <span key={index}>
      {index > 0 && t('audit.joiner')}
      {t(`audit.actions.${segment.key}`, {
        defaultValue: segment.key,
        ...segment.params,
      })}
    </span>
  ));
}

// One cell snapshot for the changes table: null = the row did not exist;
// selected with no values = the unanswered expectation; otherwise the
// quality/quantity pair (comments shown as the tooltip).
function cellText(cell) {
  if (cell === null || cell === undefined) return null;
  if (!cell.selected) return null;
  const hasValue = cell.qualityValue !== null || cell.quantityValue !== null;
  if (!hasValue) return '·';
  return [cell.qualityValue, cell.quantityValue]
    .map((value) => (value === null ? '·' : value))
    .join(' / ');
}

function cellTitle(cell) {
  if (cell === null || cell === undefined || !cell.selected) return '';
  const comments = [cell.qualityComment, cell.quantityComment]
    .filter(Boolean)
    .join(' — ');
  return comments;
}

function Details({ entry }) {
  const { t } = useTranslation(['admin', 'common']);
  const details = entry.details ?? {};

  if (entry.action === 'scores.save' && Array.isArray(details.changes)) {
    return (
      <>
        <table className="audit-changes">
          <thead>
            <tr>
              <th>{t('audit.changes.student')}</th>
              <th>{t('audit.changes.parameter')}</th>
              <th className="num">{t('audit.changes.from')}</th>
              <th className="num">{t('audit.changes.to')}</th>
              <th>{t('audit.changes.override')}</th>
            </tr>
          </thead>
          <tbody>
            {details.changes.map((change, index) => (
              <tr key={`${change.membershipId ?? 'group'}:${change.parameterId}:${index}`}>
                <td>
                  {change.student
                    ? `${change.student} (${formatStudentCode(change.studentCode)})`
                    : t('audit.changes.wholeGroup')}
                </td>
                <td>{change.parameter}</td>
                <td className="num" title={cellTitle(change.from)}>
                  {cellText(change.from) ?? '—'}
                </td>
                <td className="num" title={cellTitle(change.to)}>
                  {cellText(change.to) ??
                    (change.to && !change.to.selected
                      ? t('audit.changes.removed')
                      : '—')}
                </td>
                <td>
                  {change.override ? t('audit.changes.overridden') : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {details.moreChanges > 0 && (
          <p className="hint">
            {t('audit.changes.moreChanges', { count: details.moreChanges })}
          </p>
        )}
      </>
    );
  }
  return <pre>{JSON.stringify(details, null, 2)}</pre>;
}

function AuditPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { can } = useAuth();
  const [category, setCategory] = useState('');
  const [actorText, setActorText] = useState('');
  const [page, setPage] = useState(1);
  const actor = useDebouncedValue(actorText.trim(), 300);

  const query = useQuery({
    queryKey: ['audit', { category, actor, page }],
    queryFn: () => listAudit({ category, actor, page }),
    placeholderData: keepPreviousData,
    enabled: can('audit.view'),
  });

  if (!can('audit.view')) {
    return (
      <main>
        <EmptyState
          title={t('audit.readOnlyTitle')}
          description={t('audit.readOnlyDescription')}
        />
      </main>
    );
  }

  const { data } = query;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <main className="wide">
      <h1>{t('audit.title')}</h1>
      <p className="hint">{t('audit.hint')}</p>

      <div className="filters">
        <select
          aria-label={t('audit.categoryLabel')}
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(1);
          }}
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === ''
                ? t('audit.categories.all')
                : t(`audit.categories.${option.value}`)}
            </option>
          ))}
        </select>
        <input
          value={actorText}
          onChange={(event) => {
            setActorText(event.target.value);
            setPage(1);
          }}
          placeholder={t('audit.actorPlaceholder')}
          aria-label={t('audit.actorLabel')}
          autoComplete="off"
        />
        <button type="button" onClick={() => query.refetch()}>
          {t('common:actions.refresh')}
        </button>
      </div>

      {query.isPending && (
        <p className="hint">{t('common:status.loading')}</p>
      )}
      {query.isError && <p className="error">{errorMessage(query.error)}</p>}
      {data && data.entries.length === 0 && (
        <EmptyState
          title={t('audit.emptyTitle')}
          description={t('audit.emptyDescription')}
        />
      )}
      {data && data.entries.length > 0 && (
        <section className="section-card">
          <div className="table-wrap">
            <table className={query.isPlaceholderData ? 'stale' : undefined}>
              <thead>
                <tr>
                  <th>{t('audit.colWhen')}</th>
                  <th>{t('audit.colWho')}</th>
                  <th>{t('audit.colWhat')}</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="nowrap">{formatDateTime(entry.occurredAt)}</td>
                    <td>{entry.actor}</td>
                    <td>
                      <ActionText entry={entry} />
                      <details className="audit-details">
                        <summary>{t('audit.details')}</summary>
                        <Details entry={entry} />
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pager">
            <button
              type="button"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
            >
              {t('audit.previous')}
            </button>
            <span>
              {t('audit.pageStatus', {
                page,
                totalPages,
                total: data.total,
              })}
            </span>
            <button
              type="button"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
            >
              {t('audit.next')}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

export default AuditPage;
