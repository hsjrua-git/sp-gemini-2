import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listAlerts, resolveAlert, scanAlerts } from '../api/alerts.js';
import {
  generateSessions,
  listSessions,
  updateSession,
} from '../api/sessions.js';
import {
  assignTaskTemplate,
  archiveTaskTemplate,
  createTask,
  createTaskTemplate,
  deleteTask,
  listSessionTasks,
  listTaskTemplates,
  updateTask,
  updateTaskTemplate,
} from '../api/tasks.js';
import { listTeachers } from '../api/teachers.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import { formatIsoDate, toIsoDate } from '../lib/format.js';
import { errorMessage } from '../i18n/errors.js';

// The generated occurrences of the schedule: each row is one planned session
// (anchor + n * interval) that can be moved, canceled or annotated. The
// planned date itself never changes, so the schedule stays stable.

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function SessionEditRow({ session, onDone }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [movedTo, setMovedTo] = useState(session.movedTo ?? '');
  const [canceled, setCanceled] = useState(session.canceledAt !== null);
  const [note, setNote] = useState(session.note ?? '');

  const save = useMutation({
    mutationFn: () =>
      updateSession(session.id, {
        movedTo: movedTo === '' ? null : movedTo,
        canceled,
        note,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onDone();
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="edit-form">
      <label htmlFor={`moved-${session.id}`}>
        {t('sessions.edit.takesPlaceOn')}
      </label>
      <JalaliDatePicker
        id={`moved-${session.id}`}
        value={movedTo}
        onChange={setMovedTo}
        disabled={save.isPending}
      />
      <p className="hint">
        {t('sessions.edit.keepPlanned', {
          date: formatIsoDate(session.plannedDate),
        })}
      </p>

      <label className="hint">
        <input
          type="checkbox"
          checked={canceled}
          onChange={(event) => setCanceled(event.target.checked)}
          disabled={save.isPending}
        />{' '}
        {t('sessions.edit.canceled')}
      </label>

      <label htmlFor={`note-${session.id}`}>{t('sessions.edit.note')}</label>
      <textarea
        id={`note-${session.id}`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        rows={2}
        disabled={save.isPending}
      />

      <div className="row">
        <button type="submit" disabled={save.isPending}>
          {save.isPending
            ? t('common:actions.saving')
            : t('sessions.edit.save')}
        </button>
        <button type="button" onClick={onDone} disabled={save.isPending}>
          {t('common:actions.cancel')}
        </button>
      </div>
      {save.isError && <p className="error">{errorMessage(save.error)}</p>}
    </form>
  );
}

function SessionTasksPanel({ session, templates }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [templateId, setTemplateId] = useState('');

  const tasksQuery = useQuery({
    queryKey: ['session-tasks', session.id],
    queryFn: () => listSessionTasks(session.id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['session-tasks', session.id] });
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
  };
  const add = useMutation({
    mutationFn: () => createTask({ sessionId: session.id, title, description }),
    onSuccess: () => {
      invalidate();
      setTitle('');
      setDescription('');
    },
  });
  const toggle = useMutation({
    mutationFn: (task) => updateTask(task.id, { done: !task.done }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (task) => deleteTask(task.id),
    onSuccess: invalidate,
  });
  const fromTemplate = useMutation({
    mutationFn: () =>
      assignTaskTemplate({ templateId, sessionIds: [session.id] }),
    onSuccess: invalidate,
  });

  function handleAdd(event) {
    event.preventDefault();
    if (title.trim() !== '') add.mutate();
  }

  const busy =
    add.isPending || toggle.isPending || remove.isPending || fromTemplate.isPending;
  const tasks = tasksQuery.data ?? [];

  return (
    <div>
      <h3>
        {t('sessions.tasksPanel.title', {
          date: formatIsoDate(session.sessionDate),
          code: session.code,
        })}
      </h3>
      {tasksQuery.isPending && (
        <p className="hint">{t('common:status.loading')}</p>
      )}
      {tasksQuery.isError && (
        <p className="error" role="alert">{errorMessage(tasksQuery.error)}</p>
      )}
      {tasks.length === 0 && !tasksQuery.isPending && (
        <p className="hint">{t('sessions.tasksPanel.empty')}</p>
      )}
      {tasks.length > 0 && (
        <ul className="plain-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <label>
                <input
                  type="checkbox"
                  checked={task.done}
                  disabled={busy}
                  onChange={() => toggle.mutate(task)}
                />{' '}
                <span className={task.done ? 'hint' : undefined}>
                  {task.title}
                </span>
              </label>
              {task.description && (
                <p className="hint">{task.description}</p>
              )}
              <button
                type="button"
                className="quiet"
                onClick={() => remove.mutate(task)}
                disabled={busy}
              >
                {t('common:actions.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="edit-form">
        <label htmlFor={`task-title-${session.id}`}>
          {t('sessions.tasksPanel.newTask')}
        </label>
        <input
          id={`task-title-${session.id}`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          placeholder={t('sessions.tasksPanel.titlePlaceholder')}
          autoComplete="off"
          disabled={add.isPending}
        />
        <label htmlFor={`task-desc-${session.id}`}>
          {t('sessions.tasksPanel.descOptional')}
        </label>
        <textarea
          id={`task-desc-${session.id}`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={2000}
          rows={2}
          disabled={add.isPending}
        />
        <button type="submit" disabled={add.isPending || title.trim() === ''}>
          {add.isPending
            ? t('sessions.tasksPanel.adding')
            : t('sessions.tasksPanel.add')}
        </button>
        {(add.isError || remove.isError || toggle.isError) && (
          <p className="error" role="alert">
            {errorMessage(add.error ?? remove.error ?? toggle.error)}
          </p>
        )}
      </form>

      {templates.length > 0 && (
        <div className="row">
          <select
            aria-label={t('sessions.tasksPanel.fromTemplateLabel')}
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            disabled={fromTemplate.isPending}
          >
            <option value="">
              {t('sessions.tasksPanel.fromTemplatePlaceholder')}
            </option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => fromTemplate.mutate()}
            disabled={fromTemplate.isPending || templateId === ''}
          >
            {fromTemplate.isPending
              ? t('sessions.tasksPanel.adding')
              : t('sessions.tasksPanel.addFromTemplate')}
          </button>
          {fromTemplate.isError && (
            <p className="error" role="alert">
              {errorMessage(fromTemplate.error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TaskTemplatesManager({ templates }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['task-templates'] });
  const add = useMutation({
    mutationFn: () => createTaskTemplate({ title, description }),
    onSuccess: () => {
      invalidate();
      setTitle('');
      setDescription('');
    },
  });
  const archive = useMutation({
    mutationFn: (id) => archiveTaskTemplate(id),
    onSuccess: invalidate,
  });
  const restore = useMutation({
    mutationFn: (id) => updateTaskTemplate(id, { archived: false }),
    onSuccess: invalidate,
  });

  function handleSubmit(event) {
    event.preventDefault();
    if (title.trim() !== '') add.mutate();
  }

  return (
    <section className="section-card">
      <h2>{t('sessions.templates.title')}</h2>
      {templates.length === 0 && (
        <p className="hint">{t('sessions.templates.empty')}</p>
      )}
      {templates.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('sessions.templates.colTitle')}</th>
                <th scope="col">{t('sessions.templates.colDescription')}</th>
                <th scope="col">{t('common:table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr
                  key={template.id}
                  className={template.archivedAt ? 'stale' : undefined}
                >
                  <th scope="row">{template.title}</th>
                  <td>{template.description ?? '—'}</td>
                  <td>
                    {template.archivedAt ? (
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => restore.mutate(template.id)}
                        disabled={archive.isPending || restore.isPending}
                      >
                        {t('common:actions.restore')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => archive.mutate(template.id)}
                        disabled={archive.isPending || restore.isPending}
                      >
                        {t('common:actions.archive')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleSubmit} className="edit-form">
        <label htmlFor="template-title">
          {t('sessions.templates.newTemplate')}
        </label>
        <input
          id="template-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          placeholder={t('sessions.templates.titlePlaceholder')}
          autoComplete="off"
          disabled={add.isPending}
        />
        <label htmlFor="template-desc">
          {t('sessions.templates.descOptional')}
        </label>
        <textarea
          id="template-desc"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={2000}
          rows={2}
          disabled={add.isPending}
        />
        <button type="submit" disabled={add.isPending || title.trim() === ''}>
          {add.isPending
            ? t('sessions.templates.adding')
            : t('sessions.templates.add')}
        </button>
        {add.isError && <p className="error">{errorMessage(add.error)}</p>}
      </form>
    </section>
  );
}

function SessionsPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const today = new Date();

  const [from, setFrom] = useState(toIsoDate(addDays(today, -7)));
  const [to, setTo] = useState(toIsoDate(addDays(today, 30)));
  const [teacherId, setTeacherId] = useState('');
  const [includeCanceled, setIncludeCanceled] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [tasksForId, setTasksForId] = useState(null);

  const [generateUntil, setGenerateUntil] = useState(toIsoDate(addDays(today, 60)));
  const canManage = can('schedule.manage');
  const canPickTeachers = can('teachers.view');

  const sessionsQuery = useQuery({
    queryKey: [
      'sessions',
      { from, to, teacherId, includeCanceled, includeArchived },
    ],
    queryFn: () =>
      listSessions({
        from,
        to,
        teacherId: teacherId || null,
        includeCanceled,
        includeArchived,
      }),
  });

  const teachersQuery = useQuery({
    queryKey: ['teachers', { search: '', includeArchived: false }],
    queryFn: () => listTeachers({}),
    enabled: canPickTeachers,
  });
  const templatesQuery = useQuery({
    queryKey: ['task-templates', { includeArchived: true }],
    queryFn: () => listTaskTemplates({ includeArchived: true }),
    enabled: canManage,
  });
  const alertsQuery = useQuery({
    queryKey: ['alerts', 'open'],
    queryFn: () => listAlerts({ status: 'open' }),
    enabled: can('schedule.view'),
  });
  const openAlertsBySessionId = useMemo(
    () =>
      new Map(
        (alertsQuery.data?.alerts ?? []).map((alert) => [
          alert.sessionId,
          alert,
        ])
      ),
    [alertsQuery.data]
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['sessions'] });

  const generate = useMutation({
    mutationFn: () => generateSessions({ until: generateUntil }),
    onSuccess: invalidate,
  });
  const scan = useMutation({
    mutationFn: scanAlerts,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });
  const resolve = useMutation({
    mutationFn: (alert) => resolveAlert(alert.id, true),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });
  const quickCancel = useMutation({
    mutationFn: ({ session, canceled }) =>
      updateSession(session.id, { canceled }),
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: (session) => updateSession(session.id, { archived: true }),
    onSuccess: invalidate,
  });
  const restore = useMutation({
    mutationFn: (session) => updateSession(session.id, { archived: false }),
    onSuccess: invalidate,
  });
  const busy =
    quickCancel.isPending || archive.isPending || restore.isPending;
  const actionError = quickCancel.error ?? archive.error ?? restore.error;
  function runAction(mutation, value) {
    quickCancel.reset();
    archive.reset();
    restore.reset();
    mutation.mutate(value);
  }

  const sessions = sessionsQuery.data?.sessions ?? [];

  return (
    <main className="wide">
      <div className="page-head">
        <div>
          <h1>{t('sessions.title')}</h1>
          <p className="hint">{t('sessions.hint')}</p>
        </div>
      </div>

      {canManage && (
        <section className="section-card">
          <h2>{t('sessions.generate.title')}</h2>
          <div className="row">
            <label htmlFor="generate-until">
              {t('sessions.generate.untilLabel')}
            </label>
            <JalaliDatePicker
              id="generate-until"
              value={generateUntil}
              onChange={setGenerateUntil}
            />
            <button
              type="button"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
            >
              {generate.isPending
                ? t('sessions.generate.generating')
                : t('sessions.generate.button')}
            </button>
          </div>
          {generate.isError && (
            <p className="error" role="alert">
              {errorMessage(generate.error)}
            </p>
          )}
          {generate.isSuccess && (
            <p className="success" role="status">
              {generate.data.created === 0
                ? t('sessions.generate.allExist')
                : t('sessions.generate.created', {
                    count: generate.data.created,
                  })}
            </p>
          )}
          <div className="row">
            <button
              type="button"
              onClick={() => scan.mutate()}
              disabled={scan.isPending}
            >
              {scan.isPending
                ? t('sessions.scan.scanning')
                : t('sessions.scan.button')}
            </button>
            <span className="hint">{t('sessions.scan.hint')}</span>
          </div>
          {scan.isError && (
            <p className="error" role="alert">
              {errorMessage(scan.error)}
            </p>
          )}
          {scan.isSuccess && (
            <p className="success" role="status">
              {scan.data.raised === 0 && scan.data.resolved === 0
                ? t('sessions.scan.nothing')
                : t('sessions.scan.result', {
                    count: scan.data.raised,
                    raised: scan.data.raised,
                    resolved: scan.data.resolved,
                  })}
            </p>
          )}
        </section>
      )}

      <section className="section-card">
        <div className="toolbar">
          <label htmlFor="sessions-from">{t('sessions.from')}</label>
          <JalaliDatePicker id="sessions-from" value={from} onChange={setFrom} />
          <label htmlFor="sessions-to">{t('sessions.to')}</label>
          <JalaliDatePicker id="sessions-to" value={to} onChange={setTo} />
          {canPickTeachers && (
            <select
              aria-label={t('sessions.filterTeacher')}
              value={teacherId}
              onChange={(event) => setTeacherId(event.target.value)}
            >
              <option value="">{t('sessions.allTeachers')}</option>
              {(teachersQuery.data ?? []).map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName}
                </option>
              ))}
            </select>
          )}
          <label className="hint">
            <input
              type="checkbox"
              checked={includeCanceled}
              onChange={(event) => setIncludeCanceled(event.target.checked)}
            />
            {t('sessions.canceled')}
          </label>
          <label className="hint">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            {t('sessions.archived')}
          </label>
        </div>

        {sessionsQuery.isPending && (
          <p className="hint">{t('common:status.loading')}</p>
        )}
        {sessionsQuery.isError && (
          <p className="error" role="alert">
            {errorMessage(sessionsQuery.error)}
          </p>
        )}
        {actionError && (
          <p className="error" role="alert">{errorMessage(actionError)}</p>
        )}
        {sessionsQuery.data?.truncated && (
          <p className="hint">{t('sessions.truncated')}</p>
        )}
        {sessions.length === 0 && !sessionsQuery.isPending && (
          <EmptyState
            title={t('sessions.emptyTitle')}
            description={
              canManage
                ? t('sessions.emptyCanManage')
                : t('sessions.emptyNoManage')
            }
          />
        )}

        {sessions.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
              <tr>
                <th scope="col">{t('sessions.colDate')}</th>
                <th scope="col">{t('common:table.code')}</th>
                <th scope="col">{t('sessions.colTeacher')}</th>
                <th scope="col">{t('sessions.colTarget')}</th>
                <th scope="col">{t('sessions.colPeriod')}</th>
                <th scope="col">{t('sessions.colNote')}</th>
                {canManage && (
                  <th scope="col">{t('common:table.actions')}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const target = session.groupId
                  ? t('sessions.targetGroup', { name: session.groupName })
                  : session.studentName ?? '—';
                const openAlert = openAlertsBySessionId.get(session.id) ?? null;
                if (editingId === session.id) {
                  return (
                    <tr key={session.id}>
                      <td colSpan={canManage ? 7 : 6}>
                        <SessionEditRow
                          session={session}
                          onDone={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  );
                }
                const rows = [
                  <tr
                    key={session.id}
                    className={
                      session.canceledAt || session.archivedAt
                        ? 'stale'
                        : undefined
                    }
                  >
                    <td>
                      {formatIsoDate(session.sessionDate)}
                      {session.movedTo && (
                        <span className="hint">
                          {' '}
                          {t('sessions.movedFrom', {
                            date: formatIsoDate(session.plannedDate),
                          })}
                        </span>
                      )}
                      {session.canceledAt && (
                        <span className="hint">{t('sessions.canceledMark')}</span>
                      )}
                      {openAlert && (
                        <span className="badge warn">
                          {t('sessions.unconfirmed')}
                        </span>
                      )}
                    </td>
                    <td>
                      <code>{session.code}</code>
                    </td>
                    <td>{session.teacherName}</td>
                    <td>{target}</td>
                    <td>
                      {(session.periodSeq ?? session.periodNumber)
                        ? t('sessions.periodValue', {
                            number: session.periodSeq ?? session.periodNumber,
                          })
                        : '—'}
                    </td>
                    <td>{session.note ?? '—'}</td>
                    {canManage && (
                      <td>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() =>
                            setTasksForId(tasksForId === session.id ? null : session.id)
                          }
                        >
                          {t('sessions.tasksButton', {
                            count: session.taskCount,
                          })}
                        </button>{' '}
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => setEditingId(session.id)}
                          disabled={busy}
                        >
                          {t('common:actions.edit')}
                        </button>{' '}
                        {session.canceledAt ? (
                          <button
                            type="button"
                            className="quiet"
                            onClick={() =>
                              runAction(quickCancel, { session, canceled: false })
                            }
                            disabled={busy}
                          >
                            {t('common:actions.restore')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="quiet"
                            onClick={() =>
                              runAction(quickCancel, { session, canceled: true })
                            }
                            disabled={busy}
                          >
                            {t('common:actions.cancel')}
                          </button>
                        )}{' '}
                        {session.archivedAt ? (
                          <button
                            type="button"
                            className="quiet"
                            onClick={() => runAction(restore, session)}
                            disabled={busy}
                          >
                            {t('common:actions.unarchive')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="quiet"
                            onClick={() => runAction(archive, session)}
                            disabled={busy}
                          >
                            {t('common:actions.archive')}
                          </button>
                        )}{' '}
                        {openAlert && (
                          <button
                            type="button"
                            className="quiet"
                            onClick={() => resolve.mutate(openAlert)}
                            disabled={busy || resolve.isPending}
                          >
                            {t('sessions.resolveAlert')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>,
                ];
                if (tasksForId === session.id) {
                  rows.push(
                    <tr key={`${session.id}-tasks`}>
                      <td colSpan={canManage ? 7 : 6}>
                        <SessionTasksPanel
                          session={session}
                          templates={templatesQuery.data ?? []}
                        />
                      </td>
                    </tr>,
                  );
                }
                return rows;
              })}
            </tbody>
          </table>
        </div>
        )}
      </section>

      {canManage && <TaskTemplatesManager templates={templatesQuery.data ?? []} />}
    </main>
  );
}

export default SessionsPage;
