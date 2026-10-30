import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { assignTaskTemplate, listTaskTargets } from '../api/tasks.js';
import { errorMessage } from '../i18n/errors.js';
import { formatIsoDate } from '../lib/format.js';
import TreePicker from './TreePicker.jsx';

export default function TaskAssignment({ sessions, templates }) {
  const { t } = useTranslation('workflows');
  const client = useQueryClient();
  const [templateId, setTemplateId] = useState('');
  const [chosen, setChosen] = useState([]);
  const active = sessions.filter(s => !s.archivedAt && !s.canceledAt).slice(0, 200);
  const ids = active.map(s => s.id).sort();
  const members = useQuery({ queryKey: ['task-targets', ids], queryFn: () => listTaskTargets(ids), enabled: ids.length > 0 });
  const nodes = active.flatMap(s => [{ id: s.id, name: `${s.groupName || s.studentName || s.assignmentName || s.code} · ${s.code} · ${formatIsoDate(s.sessionDate)}`, selectable: false },
    { id: `${s.id}:group`, parentId: s.id, name: t('tasks.wholeTarget'), sessionId: s.id, membershipId: null }])
    .concat((members.data?.targets ?? []).map(m => ({ id: `${m.sessionId}:${m.membershipId}`, parentId: m.sessionId, name: `${m.fullName} · ${m.studentCode}`, ...m })));
  const targets = nodes.filter(n => chosen.includes(n.id) && n.sessionId).map(({ sessionId, membershipId }) => ({ sessionId, membershipId }));
  const assign = useMutation({ mutationFn: () => assignTaskTemplate({ templateId, targets }), onSuccess: () => {
    setChosen([]); client.invalidateQueries({ queryKey: ['session-tasks'] }); client.invalidateQueries({ queryKey: ['sessions'] });
  } });
  return <section className="section-card"><h3>{t('tasks.assign')}</h3><p className="hint">{t('tasks.snapshotHelp')}</p>
    <label>{t('tasks.template')}<select value={templateId} onChange={event => setTemplateId(event.target.value)} disabled={assign.isPending}>
      <option value="">—</option>{templates.filter(item => !item.archivedAt).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
    </select></label>
    <TreePicker label={t('tasks.targets')} items={nodes} value={chosen} onChange={setChosen} includeBranch />
    <p>{t('tasks.count', { count: targets.length })}</p>
    <button type="button" disabled={!templateId || !targets.length || targets.length > 200 || assign.isPending}
      onClick={() => assign.mutate()}>{t('tasks.assign')}</button>
    {(assign.error || members.error) && <p role="alert" className="error">{errorMessage(assign.error || members.error)}</p>}
    {assign.isSuccess && <p role="status">{t('tasks.created', { count: assign.data.created })}</p>}
    {(sessions.length > 200 || members.data?.truncated) && <p className="hint">{t('tasks.narrow')}</p>}
  </section>;
}
