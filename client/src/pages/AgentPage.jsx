import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchAgentStatus } from '../api/agent.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { formatDateTime } from '../lib/format.js';
import { errorMessage } from '../i18n/errors.js';

// The AI panel's status page. The voice agent is a separate process (agent/,
// see its README), so the server can only report the kiosk's FOOTPRINT: the
// Kiosk role, its logins, the retained dialogue log, and how many sales were
// recorded by voice. The checklist pairs those facts with the README's setup
// steps — checked where the data proves it, "manual" where only the machine
// that runs the agent can know.
function AgentPage() {
  const { t } = useTranslation(['agent', 'common']);
  const { can } = useAuth();
  const query = useQuery({
    queryKey: ['agentStatus'],
    queryFn: fetchAgentStatus,
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

  // done: true/false from the data; null = cannot be observed from here.
  const steps =
    data == null
      ? []
      : [
          { key: 'role', done: data.kioskRoleExists },
          { key: 'user', done: data.kioskUsers.length > 0 },
          { key: 'agent', done: null },
          { key: 'sale', done: data.voiceSales > 0 },
        ];

  return (
    <main>
      <h1>{t('title')}</h1>
      <p className="hint">{t('hint')}</p>

      {query.isPending && <p className="hint">{t('common:status.loading')}</p>}
      {query.isError && <p className="error">{errorMessage(query.error)}</p>}

      {data && (
        <>
          <section className="section-card">
            <h2>{t('facts.title')}</h2>
            <div className="table-wrap">
              <table>
                <tbody>
                  <tr>
                    <th scope="row">{t('facts.kioskRole')}</th>
                    <td>
                      <span className={`badge ${data.kioskRoleExists ? 'ok' : 'danger'}`}>
                        {data.kioskRoleExists ? t('facts.yes') : t('facts.missing')}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{t('facts.kioskUsers')}</th>
                    <td>
                      {data.kioskUsers.length > 0
                        ? data.kioskUsers.join(', ')
                        : t('facts.none')}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{t('facts.turns')}</th>
                    <td className="num">{data.transcripts.turns}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('facts.sessions')}</th>
                    <td className="num">{data.transcripts.sessions}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('facts.lastTurn')}</th>
                    <td>
                      {data.transcripts.lastTurn
                        ? formatDateTime(data.transcripts.lastTurn)
                        : t('facts.never')}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{t('facts.audioKept')}</th>
                    <td className="num">{data.transcripts.audioKept}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('facts.voiceSales')}</th>
                    <td className="num">{data.voiceSales}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="section-card">
            <h2>{t('setup.title')}</h2>
            <div className="table-wrap">
              <table>
                <tbody>
                  {steps.map((step) => (
                    <tr key={step.key}>
                      <th scope="row">{t(`setup.${step.key}Step`)}</th>
                      <td className="transcript-how">{t(`setup.${step.key}How`)}</td>
                      <td>
                        <span
                          className={`badge ${
                            step.done === null ? '' : step.done ? 'ok' : 'warn'
                          }`}
                        >
                          {step.done === null
                            ? t('setup.manual')
                            : step.done
                              ? t('setup.done')
                              : t('setup.todo')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">{t('setup.footnote')}</p>
          </section>
        </>
      )}
    </main>
  );
}

export default AgentPage;
