// Renders one labelled control per custom field definition. Controlled:
// `values` maps a definition id to its current editable value, and
// `onChange(id, value)` reports edits. Numbers and dates are kept as strings
// while editing; yes/no is kept as a real boolean. The value <-> `extra`
// conversion helpers live in ../lib/studentFields.js.
import { useTranslation } from 'react-i18next';
import JalaliDatePicker from './JalaliDatePicker.jsx';

function Control({ definition, controlId, value, onChange, disabled }) {
  const { t } = useTranslation(['students', 'common']);
  const common = { id: controlId, disabled, autoComplete: 'off' };

  switch (definition.fieldType) {
    case 'long_text':
      return (
        <textarea
          {...common}
          rows={3}
          maxLength={2000}
          value={value}
          onChange={(event) => onChange(definition.id, event.target.value)}
        />
      );
    case 'number':
      return (
        <input
          {...common}
          type="number"
          value={value}
          onChange={(event) => onChange(definition.id, event.target.value)}
        />
      );
    case 'date':
      return (
        <JalaliDatePicker
          id={controlId}
          value={value}
          onChange={(next) => onChange(definition.id, next)}
          disabled={disabled}
        />
      );
    case 'yes_no':
      return (
        <select
          {...common}
          value={value === true ? 'yes' : value === false ? 'no' : ''}
          onChange={(event) => {
            const next = event.target.value;
            onChange(definition.id, next === '' ? '' : next === 'yes');
          }}
        >
          <option value="">—</option>
          <option value="yes">{t('fields.yes')}</option>
          <option value="no">{t('fields.no')}</option>
        </select>
      );
    case 'choice':
      return (
        <select
          {...common}
          value={value}
          onChange={(event) => onChange(definition.id, event.target.value)}
        >
          <option value="">—</option>
          {definition.choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      );
    default:
      return (
        <input
          {...common}
          type="text"
          maxLength={200}
          value={value}
          onChange={(event) => onChange(definition.id, event.target.value)}
        />
      );
  }
}

function StudentFieldInputs({
  definitions,
  values,
  onChange,
  disabled = false,
  idPrefix = 'field',
}) {
  const { t } = useTranslation(['students', 'common']);
  if (!definitions || definitions.length === 0) return null;

  return (
    <div className="field-inputs">
      {definitions.map((definition) => {
        const controlId = `${idPrefix}-${definition.id}`;
        return (
          <div className="field-row" key={definition.id}>
            <label htmlFor={controlId}>
              {definition.label}
              {definition.isRestricted && (
                <span
                  className="badge"
                  title={t('fields.restrictedTitle')}
                >
                  {t('fields.restricted')}
                </span>
              )}
            </label>
            <Control
              definition={definition}
              controlId={controlId}
              value={values[definition.id] ?? ''}
              onChange={onChange}
              disabled={disabled}
            />
          </div>
        );
      })}
    </div>
  );
}

export default StudentFieldInputs;
