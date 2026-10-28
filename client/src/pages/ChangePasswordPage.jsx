import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import { firstAllowedPath } from '../lib/navigation.js';

const MIN_LENGTH = 10;

function ChangePasswordPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { user, can, changePassword } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [problem, setProblem] = useState(null);

  function handleSubmit(event) {
    event.preventDefault();

    if (newPassword.length < MIN_LENGTH) {
      changePassword.reset();
      setProblem(t('password.tooShort', { min: MIN_LENGTH }));
      return;
    }
    if (newPassword !== repeat) {
      changePassword.reset();
      setProblem(t('password.mismatch'));
      return;
    }

    setProblem(null);
    const wasForced = user.mustChangePassword;
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('');
          setNewPassword('');
          setRepeat('');
          if (wasForced) {
            navigate(firstAllowedPath(can), { replace: true });
          }
        },
      }
    );
  }

  return (
    <main className="narrow">
      <h1>{t('password.title')}</h1>
      {user.mustChangePassword && <p>{t('password.tempNotice')}</p>}
      <form onSubmit={handleSubmit} className="edit-form">
        <label>
          {t('password.current')}
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label>
          {t('password.new')}
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label>
          {t('password.repeat')}
          <input
            type="password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        <button type="submit" disabled={changePassword.isPending}>
          {changePassword.isPending
            ? t('password.saving')
            : t('password.submit')}
        </button>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        {changePassword.isError && (
          <p className="error" role="alert">
            {errorMessage(changePassword.error)}
          </p>
        )}
        {changePassword.isSuccess && !user.mustChangePassword && (
          <p className="success" role="status">
            {t('password.success')}
          </p>
        )}
      </form>
      <p className="hint">{t('password.hint', { min: MIN_LENGTH })}</p>
    </main>
  );
}

export default ChangePasswordPage;
