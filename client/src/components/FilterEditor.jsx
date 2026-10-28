import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_FILTERS, OPERATORS, newFilterKey } from '../lib/resultsView.js';

function FilterRow({ filter, parameters, onChange, onRemove }) {
  const { t } = useTranslation(['reports', 'common']);
  const [text, setText] = useState(
    filter.value === undefined ? '' : String(filter.value)
  );
  const operator = OPERATORS.find((item) => item.value === filter.op);
  const needsValue = operator?.needsValue ?? false;
  const invalid =
    needsValue && (text.trim() === '' || !Number.isFinite(Number(text)));
  const known = parameters.some((parameter) => parameter.id === filter.parameterId);

  function handleOperatorChange(event) {
    const op = event.target.value;
    const wantsValue = OPERATORS.find((item) => item.value === op).needsValue;
    if (!wantsValue) {
      onChange({ key: filter.key, parameterId: filter.parameterId, op });
      return;
    }
    const number = Number(text);
    const usable = text.trim() !== '' && Number.isFinite(number);
    if (!usable) setText('0');
    onChange({
      key: filter.key,
      parameterId: filter.parameterId,
      op,
      value: usable ? number : 0,
    });
  }

  function handleValueChange(event) {
    const next = event.target.value;
    setText(next);
    const number = Number(next);
    if (next.trim() !== '' && Number.isFinite(number)) {
      onChange({ ...filter, value: number });
    }
  }

  return (
    <div className="filter-row">
      <select
        aria-label={t('filter.parameterAria')}
        value={filter.parameterId}
        onChange={(event) =>
          onChange({ ...filter, parameterId: event.target.value })
        }
      >
        {!known && (
          <option value={filter.parameterId}>
            {t('filter.unknownParameter')}
          </option>
        )}
        {parameters.map((parameter) => (
          <option key={parameter.id} value={parameter.id}>
            {parameter.name}
          </option>
        ))}
      </select>
      <select
        aria-label={t('filter.conditionAria')}
        value={filter.op}
        onChange={handleOperatorChange}
      >
        {OPERATORS.map((item) => (
          <option key={item.value} value={item.value}>
            {t(`filterEditor.operators.${item.value}`)}
          </option>
        ))}
      </select>
      {needsValue && (
        <input
          type="number"
          step="any"
          aria-label={t('filter.valueAria')}
          aria-invalid={invalid}
          className={invalid ? 'invalid' : undefined}
          value={text}
          onChange={handleValueChange}
        />
      )}
      <button type="button" className="quiet" onClick={onRemove}>
        {t('filter.remove')}
      </button>
    </div>
  );
}

function FilterEditor({ filters, parameters, onChange }) {
  const { t } = useTranslation(['reports', 'common']);
  const canAdd = parameters.length > 0 && filters.length < MAX_FILTERS;

  function add() {
    onChange([
      ...filters,
      { key: newFilterKey(), parameterId: parameters[0].id, op: 'lt', value: 5 },
    ]);
  }

  return (
    <div>
      {filters.length === 0 && (
        <p className="hint">{t('filter.none')}</p>
      )}
      {filters.map((filter, index) => (
        <FilterRow
          key={filter.key ?? index}
          filter={filter}
          parameters={parameters}
          onChange={(next) =>
            onChange(filters.map((item, i) => (i === index ? next : item)))
          }
          onRemove={() => onChange(filters.filter((_, i) => i !== index))}
        />
      ))}
      <button type="button" className="primary" onClick={add} disabled={!canAdd}>
        {t('filter.add')}
      </button>
      {filters.length >= MAX_FILTERS && (
        <span className="hint">
          {' '}
          {t('filter.max', { count: MAX_FILTERS })}
        </span>
      )}
    </div>
  );
}

export default FilterEditor;