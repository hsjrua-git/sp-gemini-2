import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { deleteTask, listSessionTasks, listTaskTargets, updateTaskProgress } from '../api/tasks.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { formatDateTime } from '../lib/format.js';
import { errorMessage } from '../i18n/errors.js';

function NoteEditor({ value, onSave, disabled }) {
  const { t } = useTranslation(['workflows', 'common']);
  const [draft, setDraft] = useState(null);
  return <div className="row">
    <label>{t('tasks.note')}<textarea rows={2} maxLength={2000} value={draft ?? value ?? ''} disabled={disabled}
      onChange={event => setDraft(event.target.value)} /></label>
    <button type="button" disabled={disabled || draft === null} onClick={() => onSave(draft, () => setDraft(null))}>{t('common:actions.save')}</button>
  </div>;
}

function TaskCard({ task, target, canProgress, canManage, invalidate }) {
  const { t } = useTranslation(['workflows', 'common']);
  const save = useMutation({ mutationFn: fields => updateTaskProgress(task.id, fields), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: () => deleteTask(task.id), onSuccess: invalidate });
  const busy = save.isPending || remove.isPending;
  return <li className="task-card">
    <label className="inline"><input type="checkbox" checked={task.done} disabled={busy || !canProgress}
      onChange={event => save.mutate({ done: event.target.checked })} /><strong>{task.title}</strong></label>
    <span className="chip">{target || t('tasks.wholeTarget')}</span>
    {task.doneAt && <p className="hint">{t('tasks.completed', { date: formatDateTime(task.doneAt) })}</p>}
    {task.description && <p>{task.description}</p>}
    <ul className="plain-list">{(task.checklist ?? []).map(item => <li key={item.id}>
      <label className="inline"><input type="checkbox" checked={item.done} disabled={busy || !canProgress}
        onChange={event => save.mutate({ itemId: item.id, done: event.target.checked })} />{item.label}</label>
      {item.doneAt && <small className="hint"> {formatDateTime(item.doneAt)}</small>}
      <details><summary>{t('tasks.note')}{item.note ? ' •' : ''}</summary>
        {canProgress ? <NoteEditor value={item.note} disabled={busy} onSave={(note, done) => save.mutate({ itemId: item.id, note }, { onSuccess: done })} /> : <p>{item.note || '—'}</p>}
      </details>
    </li>)}</ul>
    <details><summary>{t('tasks.note')}{task.note ? ' •' : ''}</summary>
      {canProgress ? <NoteEditor value={task.note} disabled={busy} onSave={(note, done) => save.mutate({ note }, { onSuccess: done })} /> : <p>{task.note || '—'}</p>}
    </details>
    {canManage && <button type="button" className="quiet" disabled={busy} onClick={() => { if (window.confirm(t('tasks.confirmDelete'))) remove.mutate(); }}>{t('common:actions.delete')}</button>}
    {(save.error || remove.error) && <p className="error" role="alert">{errorMessage(save.error || remove.error)}</p>}
  </li>;
}

export default function TaskList({ sessionId }) {
  const { t } = useTranslation(['workflows', 'common']);
  const { can } = useAuth();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['session-tasks', sessionId], queryFn: () => listSessionTasks(sessionId) });
  const targets = useQuery({ queryKey: ['task-targets', [sessionId]], queryFn: () => listTaskTargets([sessionId]) });
  const invalidate = () => { client.invalidateQueries({ queryKey: ['session-tasks', sessionId] }); client.invalidateQueries({ queryKey: ['sessions'] }); };
  return <div>
    {query.isPending && <p role="status">{t('common:status.loading')}</p>}
    {(query.error || targets.error) && <p role="alert" className="error">{errorMessage(query.error || targets.error)}</p>}
    {query.data?.length === 0 && <p className="hint">{t('tasks.empty')}</p>}
    <ul className="plain-list">{query.data?.map(task => <TaskCard key={task.id} task={task}
      target={task.membershipId ? targets.data?.targets.find(target => target.membershipId === task.membershipId)?.fullName || task.membershipId : null}
      canManage={can('schedule.manage')} canProgress={can('schedule.manage') || can('scores.enter')} invalidate={invalidate} />)}</ul>
  </div>;
}
