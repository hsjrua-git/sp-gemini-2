import { useTranslation } from 'react-i18next';

function SavedViewsBar({
  views,
  activeId,
  dirty,
  busy,
  error,
  onLoad,
  onSaveAs,
  onUpdate,
  onRename,
  onDelete,
  onReset,
}) {
  const { t } = useTranslation(['reports', 'common']);

  return (
    <>
      <div className="views-bar">
        <label className="inline">
          {t('savedViews.label')}
          <select
            value={activeId ?? ''}
            onChange={(event) => onLoad(event.target.value || null)}
          >
            <option value="">{t('savedViews.unsaved')}</option>
            {views.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={activeId ? undefined : 'primary'}
          onClick={onSaveAs}
          disabled={busy}
        >
          {t('savedViews.saveAs')}
        </button>
        {activeId && (
          <>
            <button
              type="button"
              className="primary"
              onClick={onUpdate}
              disabled={busy || !dirty}
            >
              {t('savedViews.update')}
            </button>
            <button type="button" onClick={onRename} disabled={busy}>
              {t('savedViews.rename')}
            </button>
            <button
              type="button"
              className="danger"
              onClick={onDelete}
              disabled={busy}
            >
              {t('savedViews.delete')}
            </button>
          </>
        )}
        <button type="button" className="quiet" onClick={onReset}>
          {t('common:actions.reset')}
        </button>
        {activeId && dirty && (
          <span className="hint">{t('savedViews.dirty')}</span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

export default SavedViewsBar;