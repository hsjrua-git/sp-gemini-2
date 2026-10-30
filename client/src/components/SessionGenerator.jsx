import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listAssignments } from '../api/schedule.js';
import { listGroups } from '../api/groups.js';
import { generateSessions } from '../api/sessions.js';
import { assignmentTree } from '../lib/hierarchy.js';
import { formatIsoDate, toIsoDate } from '../lib/format.js';
import { errorMessage } from '../i18n/errors.js';
import TreePicker from './TreePicker.jsx';
import JalaliDatePicker from './JalaliDatePicker.jsx';

export default function SessionGenerator() {
  const { t } = useTranslation(['workflows', 'common']);
  const client = useQueryClient();
  const assignments = useQuery({ queryKey: ['assignments'], queryFn: listAssignments });
  const groups = useQuery({ queryKey: ['groups'], queryFn: listGroups });
  const [options, setOptions] = useState({ assignmentIds: [], mode: 'sessions', count: 4, from: '', until: toIsoDate(new Date()) });
  const [confirmed, setConfirmed] = useState(false);
  const preview = useMutation({ mutationFn: () => generateSessions({ ...options, dryRun: true }) });
  const create = useMutation({ mutationFn: () => generateSessions({ ...options, previewToken: preview.data.token }), onSuccess: () => {
    preview.reset(); setConfirmed(false); client.invalidateQueries({ queryKey: ['sessions'] });
  } });
  function change(patch) { setOptions(current => ({ ...current, ...patch })); preview.reset(); create.reset(); setConfirmed(false); }
  const error = preview.error || create.error || assignments.error || groups.error;
  return <section className="section-card">
    <h2>{t('generation.title')}</h2><p>{t('generation.help')}</p>
    <form onSubmit={event => { event.preventDefault(); setConfirmed(false); preview.mutate(); }}>
    <fieldset disabled={create.isPending || preview.isPending}>
      <TreePicker label={t('scope.assignments')} items={assignmentTree(assignments.data ?? [], groups.data ?? [])} value={options.assignmentIds} onChange={assignmentIds => change({ assignmentIds })} includeBranch />
      <div className="form-grid">
        <label>{t('generation.mode')}<select value={options.mode} onChange={event => change({ mode: event.target.value })}>
          {['date', 'sessions', 'periods'].map(mode => <option key={mode} value={mode}>{t(`generation.${mode}`)}</option>)}
        </select></label>
        {options.mode === 'date' ? <label>{t('generation.until')}<JalaliDatePicker value={options.until} onChange={until => change({ until })} /></label> :
          <label>{t('generation.count')}<input type="number" min={1} max={options.mode === 'periods' ? 50 : 200} value={options.count} onChange={event => change({ count: Number(event.target.value) })} /></label>}
        <label>{t('generation.from')}<JalaliDatePicker value={options.from} onChange={from => change({ from })} /></label>
      </div>
       <button type="submit" disabled={!options.assignmentIds.length}>{t('generation.preview')}</button>
      {preview.data && <>
        <p className="error" role="alert">{t('generation.warning', { count: preview.data.count })}</p>
        <div className="table-wrap scroll-list"><table><thead><tr><th>{t('scope.assignments')}</th><th>{t('generation.target')}</th><th>{t('generation.date')}</th><th>{t('common:table.code')}</th></tr></thead>
          <tbody>{preview.data.rows.map(row => <tr key={row.code}><td>{row.assignmentName} · {row.teacherName}</td><td>{row.target}</td><td>{formatIsoDate(row.plannedDate)}</td><td>{row.code}</td></tr>)}</tbody></table></div>
        <label className="inline"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t('generation.confirm')}</label>
        <button type="button" disabled={!confirmed || !preview.data.count} onClick={() => create.mutate()}>{t('generation.create')}</button>
      </>}
    </fieldset>
    </form>
    {error && <p className="error" role="alert">{errorMessage(error)}</p>}
    {create.isSuccess && <p role="status">{t('generation.created', { count: create.data.created })}</p>}
  </section>;
}
