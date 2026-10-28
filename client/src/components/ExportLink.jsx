import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';

// Warm the Export Center chunk before the click. A bare dynamic import fills the
// same module cache that App's React.lazy importer reuses, so navigation after a
// hover/focus renders the page without a loading flash.
function preload() {
  import('../pages/ExportPage.jsx');
}

// A permission-gated deep-link into the Export Center that carries the current
// page's scope as a partial config through react-router location state. The
// Export page reads it via useLocation().state?.export → mergePrefill, which
// deep-merges the scope slices onto the defaults and normalises the result — so
// a partial prefill (only the slices this page knows) is enough. Renders nothing
// for users without data.export, mirroring the CSV ExportButton's own gate.
function ExportLink({ prefill, label }) {
  const { t } = useTranslation(['reports', 'common']);
  const { can } = useAuth();
  if (!can('data.export')) return null;
  return (
    <Link
      className="btn"
      to="/export"
      state={{ export: prefill }}
      onMouseEnter={preload}
      onFocus={preload}
    >
      {label ?? t('export.openInCenter')}
    </Link>
  );
}

export default ExportLink;
