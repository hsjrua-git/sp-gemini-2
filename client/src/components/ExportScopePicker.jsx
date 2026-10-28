import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getPeriods } from '../api/periods.js';
import { listAssignments } from '../api/schedule.js';
import JalaliDatePicker from './JalaliDatePicker.jsx';
import { SCOPE_MODES } from '../lib/exportConfig.js';

// The export scope under the schema-4 model: pin ONE assignment (or leave it
// open for all of them), then choose its whole calendar, a session-date range,
// or explicit period seqs. Date ranges work across assignments; explicit seqs
// are per assignment, so they require one.
function ExportScopePicker({ value, onChange }) {
  const { t } = useTranslation(['reports', 'common']);

  const assignmentsQuery = useQuery({
    queryKey: ['assignments'],
    queryFn: listAssignments,
  });
  const assignments = assignmentsQuery.data ?? [];
  const periodsQuery = useQuery({
    queryKey: ['periods', value.assignmentId],
    queryFn: () => getPeriods(value.assignmentId),
    enabled: value.assignmentId !== null,
  });
  const periods = (periodsQuery.data ?? []).filter(
    (period) => period.sessionCount > 0
  );

  return (
    <fieldset className="export-fieldset">
      <legend>{t('scopePicker.legend')}</legend>
      <label className="inline">
        {t('scopePicker.assignment')}
        <select
          value={value.assignmentId ?? ''}
          onChange={(event) =>
            onChange({
              ...value,
              assignmentId: event.target.value || null,
              mode: event.target.value || value.mode === 'selection' ? value.mode : value.mode,
              seqs: [],
            })
          }
        >
          <option value="">{t('scopePicker.allAssignments')}</option>
          {assignments.map((assignment) => (
            <option key={assignment.id} value={assignment.id}>
              {assignment.name ?? assignment.code}
            </option>
          ))}
        </select>
      </label>

      <div className="include-list">
        {SCOPE_MODES.map((mode) => (
          <label key={mode} className="inline include-item">
            <input
              type="radio"
              name="export-scope-mode"
              value={mode}
              checked={value.mode === mode}
              onChange={() => onChange({ ...value, mode })}
            />
            <span>{t(`scopePicker.${mode}Label`)}</span>
          </label>
        ))}
      </div>

      {value.mode === 'range' && (
        <div className="toolbar">
          <label className="inline">
            {t('scopePicker.from')}
            <JalaliDatePicker
              value={value.from}
              onChange={(date) => onChange({ ...value, from: date })}
            />
          </label>
          <label className="inline">
            {t('scopePicker.to')}
            <JalaliDatePicker
              value={value.to}
              onChange={(date) => onChange({ ...value, to: date })}
            />
          </label>
        </div>
      )}

      {value.mode === 'selection' && (
        <>
          {!value.assignmentId && (
            <p className="hint">{t('scopePicker.seqNeedsAssignment')}</p>
          )}
          <div className="columns-list">
            {periods.map((period) => (
              <label key={period.id} className="inline">
                <input
                  type="checkbox"
                  checked={value.seqs.includes(period.seq)}
                  disabled={!value.assignmentId}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      seqs: event.target.checked
                        ? [...value.seqs, period.seq]
                        : value.seqs.filter((seq) => seq !== period.seq),
                    })
                  }
                />
                {t('scopePicker.seqOption', {
                  seq: period.seq,
                  answered: period.answeredCount ?? 0,
                })}
              </label>
            ))}
          </div>
        </>
      )}
    </fieldset>
  );
}

export default ExportScopePicker;
