import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import EmptyState from '../components/EmptyState.jsx';

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="9" />
      <path
        d="m15.5 8.5-2 5-5 2 2-5 5-2Z"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NotFoundPage() {
  const { t } = useTranslation(['nav', 'common']);
  return (
    <main>
      <EmptyState
        headingLevel={1}
        icon={<CompassIcon />}
        title={t('notFound.title')}
        description={t('notFound.hint')}
      >
        <Link className="btn primary" to="/students">
          {t('notFound.home')}
        </Link>
      </EmptyState>
    </main>
  );
}

export default NotFoundPage;
