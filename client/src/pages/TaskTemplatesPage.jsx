import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { archiveTaskTemplate, createTaskTemplate, listTaskTemplates, updateTaskTemplate } from '../api/tasks.js';
import { errorMessage } from '../i18n/errors.js';

export default function TaskTemplatesPage() {
  const { t } = useTranslation(['workflows', 'admin', 'common']);
  const queryClient = useQueryClient();
  const titleRef = useRef(null);
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [checklist, setChecklist] = useState('');
  const query = useQuery({ queryKey: ['task-templates', { includeArchived }], queryFn: () => listTaskTemplates({ includeArchived }) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['task-templates'] });
  function reset() {
    setEditing(null); setTitle(''); setDescription(''); setChecklist('');
  }
  const save = useMutation({
    mutationFn: () => {
      const fields = { title, description, checklist: checklist.split('\n').filter(line => line.trim()).map(label => ({ label })) };
      return editing ? updateTaskTemplate(editing, fields) : createTaskTemplate(fields);
    },
    onSuccess: () => { invalidate(); reset(); },
  });
  const archive = useMutation({
    mutationFn: template => template.archivedAt ? updateTaskTemplate(template.id, { archived: false }) : archiveTaskTemplate(template.id),
    onSuccess: invalidate,
  });
  const busy = save.isPending || archive.isPending;
  const templates = (query.data ?? []).filter(template => `${template.title} ${template.description ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  function edit(template) {
    save.reset();
    setEditing(template.id); setTitle(template.title); setDescription(template.description ?? '');
    setChecklist((template.checklist ?? []).map(item => item.label).join('\n'));
    titleRef.current?.focus();
  }
  return <main className="wide">
    <div className="page-head"><div><h1>{t('templates.title')}</h1><p className="hint">{t('templates.description')}</p></div><Link className="btn" to="/sessions">{t('templates.sessions')}</Link></div>
    <div className="template-workspace">
      <section className="section-card template-editor">
        <h2>{t(editing ? 'templates.editing' : 'templates.new')}</h2>
        <form className="edit-form" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
          <label htmlFor="template-title">{t('admin:sessions.templates.colTitle')}</label>
          <input ref={titleRef} id="template-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} required autoComplete="off" disabled={busy} />
          <label htmlFor="template-desc">{t('admin:sessions.templates.descOptional')}</label>
          <textarea id="template-desc" value={description} onChange={event => setDescription(event.target.value)} rows={3} maxLength={2000} disabled={busy} />
          <label htmlFor="template-checklist">{t('tasks.checklist')}</label>
          <textarea id="template-checklist" value={checklist} onChange={event => setChecklist(event.target.value)} rows={7} disabled={busy} />
          <p className="hint">{t('tasks.snapshotHelp')}</p>
          <div className="row">
            <button type="submit" className="primary" disabled={busy || !title.trim()}>{t(save.isPending ? 'common:actions.saving' : editing ? 'common:actions.save' : 'admin:sessions.templates.add')}</button>
            {editing && <button type="button" disabled={busy} onClick={() => { reset(); save.reset(); }}>{t('common:actions.cancel')}</button>}
          </div>
          {save.isError && <p className="error" role="alert">{errorMessage(save.error)}</p>}
          {save.isSuccess && <p className="success" role="status">{t('templates.saved')}</p>}
        </form>
      </section>
      <section className="section-card">
        <div className="toolbar"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('templates.search')} aria-label={t('templates.search')} /><label className="inline"><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} />{t('templates.archived')}</label></div>
        {query.isPending && <p role="status">{t('common:status.loading')}</p>}
        {(query.error || archive.error) && <p className="error" role="alert">{errorMessage(query.error || archive.error)}</p>}
        {!query.isPending && templates.length === 0 && <p className="hint">{t('admin:sessions.templates.empty')}</p>}
        <div className="template-list">{templates.map(template => <article className="template-card" key={template.id}>
          <div className="toolbar"><h2>{template.title}</h2>{template.archivedAt && <span className="badge">{t('templates.archivedBadge')}</span>}</div>
          {template.description && <p>{template.description}</p>}
          <p className="hint">{t('templates.items', { count: template.checklist?.length ?? 0 })}</p>
          <ul>{template.checklist?.map(item => <li key={item.id}>{item.label}</li>)}</ul>
          <div className="row"><button type="button" disabled={busy} onClick={() => edit(template)}>{t('common:actions.edit')}</button><button type="button" className="quiet" disabled={busy || editing === template.id} onClick={() => archive.mutate(template)}>{t(template.archivedAt ? 'common:actions.restore' : 'common:actions.archive')}</button></div>
        </article>)}</div>
      </section>
    </div>
  </main>;
}
