import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatIsoDate } from '../lib/format.js';
import TaskList from './TaskList.jsx';

export default function EvaluationTasks({ session, sessions }) {
  const { t } = useTranslation('workflows');
  const previous = sessions.filter(s => !s.canceledAt && !s.archivedAt && (s.sessionDate < session.sessionDate || s.sessionDate === session.sessionDate && s.seq < session.seq))
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || b.seq - a.seq);
  const [chosen, setChosen] = useState(null);
  const priorId = previous.some(s => s.id === chosen) ? chosen : previous[0]?.id;
  return <section className="section-card"><h2>{t('tasks.followUp')}</h2>
    <details><summary>{t('tasks.current')}</summary><TaskList sessionId={session.id} /></details>
    <details open><summary>{t('tasks.previous')}</summary>
      {previous.length ? <><label>{t('tasks.session')}<select value={priorId} onChange={event => setChosen(event.target.value)}>
        {previous.map(s => <option key={s.id} value={s.id}>{formatIsoDate(s.sessionDate)} · {s.code}</option>)}
      </select></label><TaskList key={priorId} sessionId={priorId} /></> : <p>{t('tasks.noPrevious')}</p>}
    </details>
  </section>;
}
