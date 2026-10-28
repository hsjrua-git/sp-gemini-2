import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { updateParameter } from '../api/parameters.js';
import { errorMessage } from '../i18n/errors.js';
import { formatRange } from '../lib/format.js';
import { numberToText, parseOptionalNumber } from '../lib/numbers.js';
import { useAuth } from '../auth/AuthContext.jsx';

// One parameter card: name + code + the shared integer range. No unit, no
// per-period activation; narrowing below recorded values is refused by the
// server with a friendly message.
function ParameterRow({ parameter }) {
  const { t } = useTranslation(['students', 'common']);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(parameter.name);
  const [code, setCode] = useState(parameter.code);
  const [minText, setMinText] = useState(numberToText(parameter.minValue));
  const [maxText, setMaxText] = useState(numberToText(parameter.maxValue));
  const [problem, setProblem] = useState(null);

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
            {t('parameters.minLabel')}
            <input
              type="number"
              step="1"
              value={minText}
              onChange={(event) => setMinText(event.target.value)}
            />
          </label>
          <label>
            {t('parameters.maxLabel')}
            <input
              type="number"
              step="1"
              value={maxText}
              onChange={(event) => setMaxText(event.target.value)}
            />
          </label>
          <div className="row">
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
    <div className="param-card">
      <div className="param-card-head">
        <h3>{parameter.name}</h3>
        {can('parameters.manage') && (
          <button type="button" className="quiet" onClick={startEditing}>
            {t('common:actions.edit')}
          </button>
        )}
      </div>
      <span className="chip-row">
        <span className="chip code">{parameter.code}</span>
        {range !== '—' && (
          <span className="chip">{t('parameters.rangeChip', { range })}</span>
        )}
        {range === '—' && <span className="hint">{t('parameters.noRange')}</span>}
      </span>
    </div>
  );
}

export default ParameterRow;
