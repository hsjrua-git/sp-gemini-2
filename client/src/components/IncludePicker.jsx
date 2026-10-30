import { useTranslation } from 'react-i18next';

// The "what to include" checkboxes. Everything is multi-select: an export can
// carry the scores cube (data), the period-over-period deltas, and the full
// edit audit trail together. `value` is config.include; `onChange` receives
// the next include object.
const ITEM_KEYS = ['data', 'delta', 'auditTrail'];

function IncludePicker({ value, onChange }) {
  const { t } = useTranslation(['reports', 'common']);

  function toggle(key, on) {
    onChange({ ...value, [key]: on });
  }

  return (
    <fieldset className="export-fieldset">
      <legend>{t('includePicker.legend')}</legend>
      <div className="include-list">
        {ITEM_KEYS.map((key) => (
          <label key={key} className="inline include-item">
            <input
              type="checkbox"
              checked={value[key]}
              onChange={(event) => toggle(key, event.target.checked)}
            />
            <span>
              {t(`includePicker.${key}Label`)}
              <span className="hint block">{t(`includePicker.${key}Hint`)}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default IncludePicker;
