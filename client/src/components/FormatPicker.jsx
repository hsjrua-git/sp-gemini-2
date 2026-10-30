import { useTranslation } from 'react-i18next';
import { TABULAR_FORMATS, LAYOUTS } from '../lib/exportConfig.js';

// Picks the file format for the tabular content and, for the scores cube, its
// shape. `value` is the whole config (it reads tabularFormat + layout); `onChange`
// receives a partial patch. Layout only matters when scores (data) are included.
function FormatPicker({ format, layout, showLayout, onChange }) {
  const { t } = useTranslation(['reports', 'common']);

  return (
    <fieldset className="export-fieldset">
      <legend>{t('formatPicker.legend')}</legend>
      <label className="inline">
        {t('formatPicker.fileFormat')}
        <select
          value={format}
          onChange={(event) => onChange({ tabularFormat: event.target.value })}
        >
          {TABULAR_FORMATS.map((item) => (
            <option key={item} value={item}>
              {t(`formatPicker.format.${item}`)}
            </option>
          ))}
        </select>
      </label>

      {showLayout && (
        <label className="inline">
          {t('formatPicker.scoresLayout')}
          <select
            value={layout}
            onChange={(event) => onChange({ layout: event.target.value })}
          >
            {LAYOUTS.map((item) => (
              <option key={item} value={item}>
                {t(`formatPicker.layout.${item}`)}
              </option>
            ))}
          </select>
        </label>
      )}
    </fieldset>
  );
}

export default FormatPicker;
