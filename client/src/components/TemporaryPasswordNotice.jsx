import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

function TemporaryPasswordNotice({ notice, onDismiss }) {
  const { t } = useTranslation(['students', 'common']);
  const [copyState, setCopyState] = useState(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(notice.temporaryPassword);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <div className="notice" role="status">
      <p>
        <strong>
          {notice.kind === 'created'
            ? t('notice.created')
            : t('notice.reset')}
        </strong>{' '}
        <Trans
          t={t}
          i18nKey="notice.intro"
          values={{ username: notice.username }}
          components={{ strong: <strong /> }}
        />
      </p>
      <p>
        <code className="secret">{notice.temporaryPassword}</code>
      </p>
      <div className="row">
        <button type="button" onClick={copy}>
          {t('notice.copy')}
        </button>
        <button type="button" onClick={onDismiss}>
          {t('notice.savedBtn')}
        </button>
      </div>
      {copyState === 'copied' && (
        <p className="success">{t('notice.copied')}</p>
      )}
      {copyState === 'failed' && (
        <p className="hint">{t('notice.copyFailed')}</p>
      )}
    </div>
  );
}

export default TemporaryPasswordNotice;