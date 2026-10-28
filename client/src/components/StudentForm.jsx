import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { createStudent } from '../api/students.js';
import { listFieldDefinitions } from '../api/fields.js';
import { errorMessage } from '../i18n/errors.js';
import { formatStudentCode } from '../lib/format.js';
import StudentFieldInputs from './StudentFieldInputs.jsx';
import { cleanExtra } from '../lib/studentFields.js';

function StudentForm() {
  const { t } = useTranslation(['students', 'common']);
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [fieldValues, setFieldValues] = useState({});
  const [problem, setProblem] = useState(null);

  const fieldsQuery = useQuery({
    queryKey: ['field-definitions'],
    queryFn: () => listFieldDefinitions(),
  });
  const definitions = fieldsQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: ({ name, extra }) => createStudent(name, extra),
    onSuccess: () => {
      setFullName('');
      setFieldValues({});
      queryClient.invalidateQueries({ queryKey: ['students'] });
    },
  });

  function handleFieldChange(id, value) {
    if (!mutation.isIdle) mutation.reset();
    setFieldValues((current) => ({ ...current, [id]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const name = fullName.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 100) {
      mutation.reset();
      setProblem(t('forms.nameProblem'));
      return;
    }
    setProblem(null);
    const extra = cleanExtra(definitions, fieldValues);
    mutation.mutate({ name, extra: Object.keys(extra).length ? extra : undefined });
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="fullName">{t('list.fullName')}</label>
      <div className="row">
        <input
          id="fullName"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder={t('forms.namePlaceholder')}
          maxLength={200}
          autoComplete="off"
        />
        {definitions.length === 0 && (
          <button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('forms.adding') : t('forms.addBtn')}
          </button>
        )}
      </div>

      <StudentFieldInputs
        definitions={definitions}
        values={fieldValues}
        onChange={handleFieldChange}
        disabled={mutation.isPending}
        idPrefix="new-student"
      />

      {definitions.length > 0 && (
        <div className="row">
          <button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('forms.adding') : t('forms.addBtn')}
          </button>
        </div>
      )}

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
          <Trans
            t={t}
            i18nKey="forms.addedWithCode"
            values={{
              name: mutation.data.fullName,
              code: formatStudentCode(mutation.data.studentCode),
            }}
            components={{ strong: <strong /> }}
          />
        </p>
      )}
    </form>
  );
}

export default StudentForm;
