import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { createAssignments, listAssignmentTargets } from '../api/schedule.js';
import { errorMessage } from '../i18n/errors.js';
import { toIsoDate } from '../lib/format.js';
import TreePicker from './TreePicker.jsx';
import JalaliDatePicker from './JalaliDatePicker.jsx';

export default function MultiAssignmentForm({ teachers, intervals, groups }) {
  const { t } = useTranslation(['admin', 'workflows', 'common']);
  const client = useQueryClient();
  const [fields, setFields] = useState({ teacherId: '', intervalId: '', anchorDate: toIsoDate(new Date()), name: '', groupIds: [], membershipIds: [] });
  const patch = next => setFields(current => ({ ...current, ...next }));
  const members = useQuery({ queryKey: ['assignment-targets'], queryFn: listAssignmentTargets });
  const nodes = [...groups.map(g => ({ ...g, id: `g:${g.id}`, parentId: g.parentId ? `g:${g.parentId}` : null, selectable: false })),
    ...(members.data?.memberships ?? []).map(m => ({ ...m, parentId: `g:${m.groupId}`, name: `${m.fullName} · ${m.studentCode}` }))];
  const save = useMutation({ mutationFn: () => createAssignments(fields), onSuccess: () => {
    client.invalidateQueries({ queryKey: ['assignments'] }); patch({ groupIds: [], membershipIds: [] });
  } });
  return <form onSubmit={event => { event.preventDefault(); save.mutate(); }}>
    <p className="hint">{t('workflows:assignment.help')}</p>
    <fieldset disabled={save.isPending}>
      <div className="form-grid">
        <label>{t('schedule.form.teacher')}<select required value={fields.teacherId} onChange={event => patch({ teacherId: event.target.value })}>
          <option value="">—</option>{teachers.filter(item => !item.archivedAt).map(item => <option key={item.id} value={item.id}>{item.fullName}</option>)}
        </select></label>
        <label>{t('schedule.form.every')}<select required value={fields.intervalId} onChange={event => patch({ intervalId: event.target.value })}>
          <option value="">—</option>{intervals.filter(item => !item.archivedAt).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>{t('schedule.form.anchor')}<JalaliDatePicker required value={fields.anchorDate} onChange={anchorDate => patch({ anchorDate })} /></label>
        <label>{t('schedule.form.nameOptional')}<input value={fields.name} onChange={event => patch({ name: event.target.value })} maxLength={100} /></label>
      </div>
      <div className="form-grid">
        <TreePicker label={t('workflows:scope.groups')} items={groups.filter(g => !g.archivedAt)} value={fields.groupIds} onChange={groupIds => patch({ groupIds })} includeBranch />
        <TreePicker label={t('workflows:assignment.students')} items={nodes} value={fields.membershipIds} onChange={membershipIds => patch({ membershipIds })} includeBranch />
      </div>
      <p>{t('workflows:assignment.count', { count: fields.groupIds.length + fields.membershipIds.length })}</p>
      <button type="submit" disabled={!fields.groupIds.length && !fields.membershipIds.length}>{t('schedule.form.add')}</button>
    </fieldset>
    {(save.error || members.error) && <p className="error" role="alert">{errorMessage(save.error || members.error)}</p>}
    {save.isSuccess && <p role="status">{t('workflows:assignment.created', { count: save.data.created })}</p>}
    {members.data?.truncated && <p>{t('workflows:assignment.limit')}</p>}
  </form>;
}
