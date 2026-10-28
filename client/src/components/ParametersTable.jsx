import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listParameters } from '../api/parameters.js';
import { errorMessage } from '../i18n/errors.js';
import ParameterRow from './ParameterRow.jsx';

function ParametersTable() {
  const { t } = useTranslation(['students', 'common']);
  const {
    data: parameters,
    isPending,
    isError,
    error,
  } = useQuery({ queryKey: ['parameters'], queryFn: listParameters });

  if (isPending) return <p className="hint">{t('parameters.loading')}</p>;
  if (isError) return <p className="error">{errorMessage(error)}</p>;
  if (parameters.length === 0) {
    return <p className="hint">{t('parameters.empty')}</p>;
  }

  return (
    <div className="param-grid">
      {parameters.map((parameter) => (
        <ParameterRow key={parameter.id} parameter={parameter} />
      ))}
    </div>
  );
}

export default ParametersTable;