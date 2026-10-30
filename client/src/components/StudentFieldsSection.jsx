import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listFieldDefinitions } from '../api/fields.js';
import { updateStudent } from '../api/students.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import StudentFieldInputs from './StudentFieldInputs.jsx';
import { buildExtraPatch, extraToValues } from '../lib/studentFields.js';
import { formatIsoDate } from '../lib/format.js';

function displayValue(t, definition, raw) {
  if (raw === undefined || raw === null || raw === '') return '—';
  if (definition.fieldType === 'yes_no') {
    return raw ? t('fields.yes') : t('fields.no');
  }
  if (definition.fieldType === 'date') {
    return formatIsoDate(raw);
  }
  return String(raw);
}

function StudentFieldsSection({ student }) {
  const { t } = useTranslation(['students', 'common']);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [values, setValues] = useState({});

  const fieldsQuery = useQuery({
    queryKey: ['field-definitions'],
    queryFn: () => listFieldDefinitions(),
  });
  const definitions = fieldsQuery.data ?? [];

  const save = useMutation({
    mutationFn: (extra) => updateStudent(student.id, { extra }),
    onSuccess: () => {
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ['student', student.id] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
    },
  });

  if (fieldsQuery.isPending || definitions.length === 0) return null;

  function startEditing() {
    setValues(extraToValues(definitions, student.extra));
    save.reset();
    setIsEditing(true);
  }

  function handleChange(id, value) {
    setValues((current) => ({ ...current, [id]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    save.mutate(buildExtraPatch(definitions, values));
  }

  return (
    <section className="section-card">
      <h2>{t('detail.fieldsTitle')}</h2>
      {isEditing ? (
        <form onSubmit={handleSubmit}>
          <StudentFieldInputs
            definitions={definitions}
            values={values}
            onChange={handleChange}
            disabled={save.isPending}
            idPrefix={`edit-${student.id}`}
          />
          <div className="row">
            <button type="submit" disabled={save.isPending}>
              {save.isPending ? t('common:actions.saving') : t('detail.saveDetails')}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              disabled={save.isPending}
            >
              {t('common:actions.cancel')}
            </button>
          </div>
          {save.isError && (
            <p className="error">{errorMessage(save.error)}</p>
          )}
        </form>
      ) : (
        <>
          <dl className="field-list">
            {definitions.map((definition) => (
              <div className="field-list-row" key={definition.id}>
                <dt>{definition.label}</dt>
                <dd>
                  {displayValue(t, definition, student.extra?.[definition.id])}
                </dd>
              </div>
            ))}
          </dl>
          {can('students.edit') && (
            <button type="button" onClick={startEditing}>
              {t('detail.editDetails')}
            </button>
          )}
        </>
      )}
    </section>
  );
}

export default StudentFieldsSection;
