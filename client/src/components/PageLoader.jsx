import { useTranslation } from 'react-i18next';

// Shown by <Suspense> while a lazily-loaded page's code chunk is downloading.
// role="status" + aria-live so screen readers announce the wait; a small brand
// spinner over a centered column reads as a deliberate loading state rather than
// a bare line. The spin is disabled under prefers-reduced-motion (see index.css),
// leaving a static ring plus the polite loading text.
function PageLoader() {
  const { t } = useTranslation('common');
  return (
    <main aria-busy="true">
      <div className="page-loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <p>{t('status.loading')}</p>
      </div>
    </main>
  );
}

export default PageLoader;
