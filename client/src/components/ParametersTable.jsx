import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listParameters } from '../api/parameters.js';
import { errorMessage } from '../i18n/errors.js';
import ParameterRow from './ParameterRow.jsx';
import { hierarchy } from '../lib/hierarchy.js';

function ParametersTable() {
  const { t } = useTranslation(['students', 'common', 'workflows']);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState([]);
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
    <div className="parameter-tree">
      <input type="search" aria-label={t('workflows:tree.search', { label: t('parameters.title') })} placeholder={t('workflows:tree.search', { label: t('parameters.title') })} value={search} onChange={event => setSearch(event.target.value)} />
      {hierarchy(parameters).filter(parameter => search.trim() ? parameter.path.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) : !parameter.ancestorIds.some(id => collapsed.includes(id))).map((parameter) => (
        <ParameterRow key={parameter.id} parameter={parameter} parameters={parameters} expanded={!collapsed.includes(parameter.id)} onToggle={() => setCollapsed(current => current.includes(parameter.id) ? current.filter(id => id !== parameter.id) : [...current, parameter.id])} />
      ))}
    </div>
  );
}

export default ParametersTable;
