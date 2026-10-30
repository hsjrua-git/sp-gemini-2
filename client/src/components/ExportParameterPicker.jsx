import { useTranslation } from 'react-i18next';
import TreePicker from './TreePicker.jsx';

// The "what parameters" selector: all parameters, or a chosen subset. `value`
// is the config.parameters slice ({ mode, ids }); `parameters` is the full list
// (already loaded by the page). Mirrors the Results "Columns" multiselect.
function ExportParameterPicker({ value, parameters, onChange }) {
  const { t } = useTranslation(['reports', 'common']);
  const selecting = value.mode === 'selection';

  function setMode(mode) {
    onChange({ ...value, mode });
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
        <TreePicker label={t('pickers.parametersLegend')} items={parameters} value={value.ids} onChange={ids => onChange({ ...value, ids })} includeBranch />
      )}
    </fieldset>
  );
}

export default ExportParameterPicker;
