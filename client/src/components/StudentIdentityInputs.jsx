import { useTranslation } from 'react-i18next';
import { toLatinDigits } from '../lib/locale.js';
import JalaliDatePicker from './JalaliDatePicker.jsx';

export default function StudentIdentityInputs({ value, onChange, disabled = false, required = false, idPrefix = 'identity' }) {
  const { t } = useTranslation('students');
  const patch = (key, next) => onChange({ ...value, [key]: next });
  const today = new Date();
  const maxDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return <div className="form-grid">
    <label>{t('detail.gender')}
      <select value={value.gender ?? ''} onChange={event => patch('gender', event.target.value)} disabled={disabled} required={required}>
        <option value="">{t('detail.notSet')}</option>
        <option value="male">{t('detail.male')}</option><option value="female">{t('detail.female')}</option>
      </select>
    </label>
    <div><label htmlFor={`${idPrefix}-birth`}>{t('detail.birthDate')}</label>
      <JalaliDatePicker id={`${idPrefix}-birth`} value={value.birthDate ?? ''} onChange={date => patch('birthDate', date)} disabled={disabled} required={required} max={maxDate} />
    </div>
    <label>{t('detail.fatherName')}
      <input value={value.fatherName ?? ''} onChange={event => patch('fatherName', event.target.value)} required={required} minLength={2} maxLength={100} disabled={disabled} autoComplete="off" />
    </label>
    <label>{t('detail.nationalId')}
      <input value={value.nationalId ?? ''} onChange={event => patch('nationalId', toLatinDigits(event.target.value))} required={required} pattern="[0-9]{10}" maxLength={10} inputMode="numeric" disabled={disabled} autoComplete="off" />
    </label>
  </div>;
}
