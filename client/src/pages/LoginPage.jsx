import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import { LANGUAGES, setLanguage } from '../i18n/index.js';
import {
  firstAllowedPath,
  hasRoutePermission,
  permissionForPath,
} from '../lib/navigation.js';

// The pre-login surface: fully bilingual before any preference can load. The
// remembered draft (localStorage) picks the language at boot; the switcher in
// the corner writes it back, so the next visit starts where the last one
// ended. Once signed in, the stored `language` preference takes over.

function LanguageSwitcher({ current }) {
  return (
    <div
      className="segmented auth-language"
      role="radiogroup"
      aria-label={current.t('language.switch')}
    >
      {LANGUAGES.map((code) => (
        <label key={code}>
          <input
            type="radio"
            name="auth-language"
            checked={current.language === code}
            onChange={() => setLanguage(code)}
          />
          {current.t(`language.${code}`)}
        </label>
      ))}
    </div>
  );
}

function LoginPage() {
  const { user, isLoading, login, can } = useAuth();
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (isLoading) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <p>{t('common:status.loading')}</p>
        </div>
      </main>
    );
  }
  if (user) {
    // Honor `location.state.from` if the user was redirected to /login from a
    // route their role is allowed to access; otherwise land on the first page
    // their role can open. `replace` keeps /login out of history.
    const from = location.state?.from;
    const fromPath = from?.pathname;
    const canOpenFrom =
      typeof fromPath === 'string' &&
      fromPath.startsWith('/') &&
      fromPath !== '/login' &&
      hasRoutePermission(can, permissionForPath(fromPath));
    const target = canOpenFrom
      ? `${fromPath}${from?.search ?? ''}`
      : firstAllowedPath(can);
    return <Navigate to={target} replace />;
  }

  function handleSubmit(event) {
    event.preventDefault();
    login.mutate({ username, password });
  }

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <LanguageSwitcher current={{ t, language: i18n.resolvedLanguage }} />
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="auth-brand-name">{t('appName')}</span>
        </div>
        <h1 className="auth-title">{t('login.title')}</h1>
        <p className="auth-subtitle">{t('login.subtitle')}</p>
        <form onSubmit={handleSubmit} className="edit-form">
          <label>
            {t('login.username')}
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label>
            {t('login.password')}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button type="submit" disabled={login.isPending}>
            {login.isPending ? t('login.submitting') : t('login.submit')}
          </button>
          {login.isError && (
            <p className="error" role="alert">
              {errorMessage(login.error)}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}

export default LoginPage;
