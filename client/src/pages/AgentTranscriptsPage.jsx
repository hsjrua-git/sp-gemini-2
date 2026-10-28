import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listTranscripts } from '../api/agent.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import { formatDateTime } from '../lib/format.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { errorMessage } from '../i18n/errors.js';

// The retained voice-dialogue log (agent.view). One row per turn, newest
// first: what the kiosk heard (user) or answered (agent). The text reads in
// its own direction (dir="auto") because the kiosk is bilingual. Audio is
// ephemeral by design — the audio-kept badge marks the few turns that kept
// theirs. The server caps the answer at 100 turns and reports `truncated`.
function AgentTranscriptsPage() {
  const { t } = useTranslation(['agent', 'common']);
  const { can } = useAuth();
  const [sessionText, setSessionText] = useState('');
  const [role, setRole] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const sessionId = useDebouncedValue(sessionText.trim(), 300);

  const query = useQuery({
    queryKey: ['agentTranscripts', { sessionId, role, from, to }],
    queryFn: () => listTranscripts({ sessionId, role, from, to }),
    placeholderData: keepPreviousData,
    enabled: can('agent.view'),
  });

  if (!can('agent.view')) {
    return (
      <main>
        <EmptyState title={t('noAccessTitle')} />
      </main>
    );
  }

  const { data } = query;

  return (
    <main className="wide">
      <h1>{t('transcripts.title')}</h1>
      <p className="hint">{t('transcripts.hint')}</p>

      <div className="filters">
        <input
          value={sessionText}
          onChange={(event) => setSessionText(event.target.value)}
          placeholder={t('transcripts.sessionPlaceholder')}
          aria-label={t('transcripts.sessionLabel')}
          autoComplete="off"
          dir="ltr"
        />
        <select
          aria-label={t('transcripts.roleLabel')}
          value={role}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="">{t('transcripts.roleAll')}</option>
          <option value="user">{t('transcripts.roleUser')}</option>
          <option value="agent">{t('transcripts.roleAgent')}</option>
        </select>
        <label htmlFor="agent-transcripts-from" className="hint">
          {t('transcripts.fromLabel')}
        </label>
        <JalaliDatePicker id="agent-transcripts-from" value={from} onChange={setFrom} />
        <label htmlFor="agent-transcripts-to" className="hint">
          {t('transcripts.toLabel')}
        </label>
        <JalaliDatePicker id="agent-transcripts-to" value={to} onChange={setTo} />
        <button type="button" onClick={() => query.refetch()}>
          {t('common:actions.refresh')}
        </button>
      </div>

      {query.isPending && <p className="hint">{t('common:status.loading')}</p>}
      {query.isError && <p className="error">{errorMessage(query.error)}</p>}
      {data && data.transcripts.length === 0 && (
        <EmptyState
          title={t('transcripts.emptyTitle')}
          description={t('transcripts.emptyDescription')}
        />
      )}
      {data && data.transcripts.length > 0 && (
        <section className="section-card">
          <div className="table-wrap">
            <table className={query.isPlaceholderData ? 'stale' : undefined}>
              <thead>
                <tr>
                  <th>{t('transcripts.colWhen')}</th>
                  <th>{t('transcripts.colRole')}</th>
                  <th>{t('transcripts.colText')}</th>
                  <th>{t('transcripts.colSession')}</th>
                </tr>
              </thead>
              <tbody>
                {data.transcripts.map((turn) => (
                  <tr key={turn.id}>
                    <td className="nowrap">{formatDateTime(turn.createdAt)}</td>
                    <td>
                      <span
                        className={`badge ${turn.role === 'agent' ? 'brand' : ''}`}
                      >
                        {turn.role === 'agent'
                          ? t('transcripts.roleAgent')
                          : t('transcripts.roleUser')}
                      </span>
                      {turn.audioKept && (
                        <span className="badge">{t('transcripts.audioKept')}</span>
                      )}
                    </td>
                    <td className="transcript-text" dir="auto">
                      {turn.text}
                      {turn.meta && Object.keys(turn.meta).length > 0 && (
                        <details className="audit-details">
                          <summary>{t('transcripts.meta')}</summary>
                          <pre>{JSON.stringify(turn.meta, null, 2)}</pre>
                        </details>
                      )}
                    </td>
                    <td className="nowrap">
                      <button
                        type="button"
                        className="link"
                        title={turn.sessionId}
                        onClick={() => setSessionText(turn.sessionId)}
                      >
                        {turn.sessionId.slice(0, 8)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.truncated && (
            <p className="hint">{t('transcripts.truncated')}</p>
          )}
        </section>
      )}
    </main>
  );
}

export default AgentTranscriptsPage;
