import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isoFromJalaliText, jalaliTextFromIso } from '../lib/locale.js';

// A date field that accepts either calendar: a native Gregorian input plus a
// Jalali text field showing the same day (Persian digits, yyyy/mm/dd). The
// two always mirror each other; typing an impossible Jalali date is flagged
// inline without clearing the value. The controlled value stays ISO
// Gregorian ('' when empty) — exactly what the API speaks.
function JalaliDatePicker({ id, value, onChange, disabled = false }) {
  const { t } = useTranslation(['common', 'nav']);
  const [jalaliDraft, setJalaliDraft] = useState(null);
  const [jalaliInvalid, setJalaliInvalid] = useState(false);

  const shown = jalaliDraft ?? (value ? jalaliTextFromIso(value) : '');

  function handleJalaliChange(text) {
    setJalaliDraft(text);
    if (text.trim() === '') {
      setJalaliInvalid(false);
      onChange('');
      setJalaliDraft(null);
      return;
    }
    const iso = isoFromJalaliText(text);
    if (iso === null) {
      setJalaliInvalid(true);
      return;
    }
    setJalaliInvalid(false);
    onChange(iso);
    setJalaliDraft(null);
  }

  return (
    <span className="jalali-date-picker">
      <input
        id={id}
        type="date"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={t('date.gregorian')}
      />
      <input
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={shown}
        onChange={(event) => handleJalaliChange(event.target.value)}
        onFocus={() => setJalaliDraft(shown)}
        onBlur={() => {
          setJalaliDraft(null);
          setJalaliInvalid(false);
        }}
        placeholder={t('date.jalaliPlaceholder')}
        aria-label={t('date.jalali')}
        aria-invalid={jalaliInvalid || undefined}
        disabled={disabled}
      />
      {jalaliInvalid && (
        <span className="error" role="alert">
          {t('date.invalidJalali')}
        </span>
      )}
    </span>
  );
}

export default JalaliDatePicker;
