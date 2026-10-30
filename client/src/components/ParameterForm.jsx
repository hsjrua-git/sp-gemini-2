import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { createParameter, listParameters } from '../api/parameters.js';
import { errorMessage } from '../i18n/errors.js';
import { parseOptionalNumber } from '../lib/numbers.js';
import HierarchySelect from './HierarchySelect.jsx';

// A parameter is identified by a unique code and carries the integer range
// for quantity. Quality is always a percentage. There is no per-period activation
// anymore — applicability is the evaluator's cell selection.
function ParameterForm() {
  const { t } = useTranslation(['students', 'common', 'workflows']);
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [problem, setProblem] = useState(null);
  const [parentId, setParentId] = useState('');
  const parameters = useQuery({ queryKey: ['parameters'], queryFn: listParameters });

  const mutation = useMutation({
    mutationFn: createParameter,
    onSuccess: () => {
      setCode('');
      setName('');
      setMinText('');
      setMaxText('');
      setParentId('');
      queryClient.invalidateQueries({ queryKey: ['parameters'] });
    },
  });

  function fail(message) {
    mutation.reset();
    setProblem(message);
  }

  function handleSubmit(event) {
    event.preventDefault();

    const min = parseOptionalNumber(minText);
    const max = parseOptionalNumber(maxText);

    if (code.trim() === '') return fail(t('parameters.problemCode'));
    if (name.trim() === '') return fail(t('parameters.problemName'));
    if (min.error || max.error) {
      return fail(t('parameters.problemNumbers'));
    }
    if (min.value !== null && max.value !== null && min.value > max.value) {
      return fail(t('parameters.problemRange'));
    }

    setProblem(null);
    mutation.mutate({
      code: code.trim(),
      name,
      minValue: min.value,
      maxValue: max.value,
      parentId: parentId || null,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-grid">
        <label>
          {t('parameters.codeLabel')}
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={t('parameters.codePlaceholder')}
            maxLength={40}
            autoComplete="off"
          />
        </label>
        <label>
          {t('common:table.name')}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('parameters.namePlaceholder')}
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
      </div>
      <label>{t('workflows:tree.parent')}
        <HierarchySelect items={parameters.data ?? []} value={parentId} onChange={setParentId} emptyLabel={t('workflows:tree.root')} />
      </label>
      <p className="hint">{t('workflows:quality')}</p>

      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? t('forms.adding') : t('parameters.addBtn')}
      </button>

      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {mutation.isError && (
        <p className="error" role="alert">
          {errorMessage(mutation.error)}
        </p>
      )}
      {mutation.isSuccess && (
        <p className="success" role="status">
          {t('parameters.added', { name: mutation.data.name })}
        </p>
      )}
    </form>
  );
}

export default ParameterForm;
