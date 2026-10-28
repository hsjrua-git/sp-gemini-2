import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

// The "what parameters" selector: all parameters, or a chosen subset. `value`
// is the config.parameters slice ({ mode, ids }); `parameters` is the full list
// (already loaded by the page). Mirrors the Results "Columns" multiselect.
function ExportParameterPicker({ value, parameters, onChange }) {
  const { t } = useTranslation(['reports', 'common']);
  const [search, setSearch] = useState('');
  const selecting = value.mode === 'selection';
  const selected = useMemo(() => new Set(value.ids), [value.ids]);

  const needle = search.trim().toLowerCase();
  const shown = needle
    ? parameters.filter((parameter) => parameter.name.toLowerCase().includes(needle))
    : parameters;

  function setMode(mode) {
    onChange({ ...value, mode });
  }

  function toggle(id, on) {
    const ids = on ? [...selected, id] : value.ids.filter((item) => item !== id);
    onChange({ ...value, ids: [...new Set(ids)] });
  }

  return (
    <fieldset className="export-fieldset">
      <legend>{t('pickers.parametersLegend')}</legend>
      <div className="radio-row">
        <label className="inline">
          <input
            type="radio"
            name="parameter-mode"
            checked={value.mode === 'all'}
            onChange={() => setMode('all')}
          />
          {t('pickers.allParameters')}
        </label>
        <label className="inline">
          <input
            type="radio"
            name="parameter-mode"
            checked={value.mode === 'selection'}
            onChange={() => setMode('selection')}
          />
          {t('pickers.pickParameters')}
        </label>
      </div>

      {selecting && (
        <div className="export-picker">
          {parameters.length > 8 && (
            <input
              type="search"
              className="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('pickers.searchParameters')}
              aria-label={t('pickers.searchParameters')}
            />
          )}
          <p className="hint">
            {t('pickers.selected', { count: value.ids.length })}
            {value.ids.length > 0 && (
              <>
                {' · '}
                <button
                  type="button"
                  className="quiet"
                  onClick={() => onChange({ ...value, ids: [] })}
                >
                  {t('pickers.clear')}
                </button>
              </>
            )}
          </p>
          <div className="columns-list scroll-list">
            {shown.map((parameter) => (
              <label key={parameter.id} className="inline">
                <input
                  type="checkbox"
                  checked={selected.has(parameter.id)}
                  onChange={(event) => toggle(parameter.id, event.target.checked)}
                />
                {parameter.name}
              </label>
            ))}
            {shown.length === 0 && (
              <p className="hint">{t('pickers.noParametersMatch')}</p>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}

export default ExportParameterPicker;
