import { Navigate, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from './EmptyState.jsx';
import PageLoader from './PageLoader.jsx';
import { errorMessage } from '../i18n/errors.js';

function RequireAuth() {
  const { user, isLoading, loadError } = useAuth();
  const { t } = useTranslation(['nav', 'common']);
  const location = useLocation();

  if (isLoading) {
    return <PageLoader />;
  }
  if (loadError) {
    return (
      <main>
        <EmptyState
          tone="danger"
          title={t('auth.sessionErrorTitle')}
          description={errorMessage(loadError)}
        />
      </main>
    );
  }
  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: { pathname: location.pathname, search: location.search } }}
      />
    );
  }
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

export default RequireAuth;
