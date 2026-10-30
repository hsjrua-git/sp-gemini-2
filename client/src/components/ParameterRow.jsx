import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { updateParameter } from '../api/parameters.js';
import { errorMessage } from '../i18n/errors.js';
import { formatRange } from '../lib/format.js';
import { numberToText, parseOptionalNumber } from '../lib/numbers.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { branchIds } from '../lib/hierarchy.js';
import HierarchySelect from './HierarchySelect.jsx';

// One parameter card: name + code + the shared integer range. No unit, no
// per-period activation; narrowing below recorded values is refused by the
// server with a friendly message.
function ParameterRow({ parameter, parameters = [], expanded = true, onToggle }) {
  const { t } = useTranslation(['students', 'common', 'workflows']);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(parameter.name);
  const [code, setCode] = useState(parameter.code);
  const [minText, setMinText] = useState(numberToText(parameter.minValue));
  const [maxText, setMaxText] = useState(numberToText(parameter.maxValue));
  const [problem, setProblem] = useState(null);
  const [parentId, setParentId] = useState(parameter.parentId ?? '');
  const excluded = new Set(branchIds(parameters, [parameter.id]));

  const update = useMutation({
    mutationFn: (fields) => updateParameter(parameter.id, fields),
    onSuccess: () => {
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ['parameters'] });
    },
  });

  function startEditing() {
    setName(parameter.name);
    setCode(parameter.code);
    setMinText(numberToText(parameter.minValue));
    setMaxText(numberToText(parameter.maxValue));
    setParentId(parameter.parentId ?? '');
    setProblem(null);
    update.reset();
    setIsEditing(true);
  }

  function handleSave(event) {
    event.preventDefault();

    const min = parseOptionalNumber(minText);
    const max = parseOptionalNumber(maxText);

    if (name.trim() === '') {
      setProblem(t('parameters.problemName'));
      return;
    }
    if (code.trim() === '') {
      setProblem(t('parameters.problemCode'));
      return;
    }
    if (min.error || max.error) {
      setProblem(t('parameters.problemNumbers'));
      return;
    }
    if (min.value !== null && max.value !== null && min.value > max.value) {
      setProblem(t('parameters.problemRange'));
      return;
    }

    setProblem(null);
    update.mutate({
      name,
      code: code.trim(),
      minValue: min.value,
      maxValue: max.value,
      parentId: parentId || null,
    });
  }

  if (isEditing) {
    return (
      <div className="param-card">
        <form onSubmit={handleSave} className="edit-form">
          <label>
            {t('parameters.codeLabel')}
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={40}
              autoComplete="off"
            />
          </label>
          <label>
            {t('common:table.name')}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              autoComplete="off"
            />
          </label>
          <label>
            {t('workflows:quantityMin')}
            <input
              type="number"
              step="1"
              value={minText}
              onChange={(event) => setMinText(event.target.value)}
            />
          </label>
          <label>
            {t('workflows:quantityMax')}
            <input
              type="number"
              step="1"
              value={maxText}
              onChange={(event) => setMaxText(event.target.value)}
            />
          </label>
          <div className="row">
            <label>{t('workflows:tree.parent')}
              <HierarchySelect items={parameters.filter(item => !excluded.has(item.id))} value={parentId} onChange={setParentId} emptyLabel={t('workflows:tree.root')} />
            </label>
            <button type="submit" disabled={update.isPending}>
              {t('common:actions.save')}
            </button>
            <button type="button" onClick={() => setIsEditing(false)}>
              {t('common:actions.cancel')}
            </button>
          </div>
          {problem && <p className="error">{problem}</p>}
          {update.isError && (
            <p className="error">{errorMessage(update.error)}</p>
          )}
        </form>
      </div>
    );
  }

  const range = formatRange(parameter);
  return (
    <div className={`param-card${parameter.depth ? ' param-child' : ''}`}>
      <div className="param-card-head">
        {parameter.hasChildren && <button type="button" className="quiet tree-disclosure" aria-expanded={expanded} aria-label={t('workflows:tree.expand', { name: parameter.name })} onClick={onToggle}><span aria-hidden="true">⌄</span></button>}
        <h3 title={parameter.path}>{parameter.name}{parameter.depth > 0 && <span className="hierarchy-context">{parameter.path.split(' / ').slice(0, -1).join(' / ')}</span>}</h3>
        {can('parameters.manage') && (
          <button type="button" className="quiet" onClick={startEditing}>
            {t('common:actions.edit')}
          </button>
        )}
      </div>
      <span className="chip-row">
        <span className="chip code">{parameter.code}</span>
        <span className="chip">{t('workflows:quality')}</span>
        {range !== '—' && (
          <span className="chip">{t('workflows:quantityRange')}: {range}</span>
        )}
        {range === '—' && <span className="hint">{t('parameters.noRange')}</span>}
      </span>
    </div>
  );
}

export default ParameterRow;
