import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchAllStudents } from '../api/students.js';
import { errorMessage } from '../i18n/errors.js';
import GroupFilter from './GroupFilter.jsx';

// The "who" selector for the Export Center: all students, one group (and its
// subgroups), or a hand-picked set. `value` is the config.students slice
// ({ mode, groupId, ids }); `onChange` receives the next slice. The full roster
// is only fetched when the user actually switches to hand-picking.
function ExportStudentPicker({ value, onChange }) {
  const { t } = useTranslation(['reports', 'common']);
  const [search, setSearch] = useState('');
  const selecting = value.mode === 'selection';

  const rosterQuery = useQuery({
    queryKey: ['all-students'],
    queryFn: fetchAllStudents,
    enabled: selecting,
    staleTime: 5 * 60_000,
  });
  const roster = rosterQuery.data ?? [];

  const selected = useMemo(() => new Set(value.ids), [value.ids]);
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? roster.filter(
        (student) =>
          student.fullName.toLowerCase().includes(needle) ||
          student.studentCode.toLowerCase().includes(needle)
      )
    : roster;

  function setMode(mode) {
    onChange({ ...value, mode });
  }

  function toggle(id, on) {
    const ids = on ? [...selected, id] : value.ids.filter((item) => item !== id);
    onChange({ ...value, ids: [...new Set(ids)] });
  }

  return (
    <fieldset className="export-fieldset">
      <legend>{t('pickers.studentsLegend')}</legend>
      <div className="radio-row">
        <label className="inline">
          <input
            type="radio"
            name="student-mode"
            checked={value.mode === 'all'}
            onChange={() => setMode('all')}
          />
          {t('shared.allStudents')}
        </label>
        <label className="inline">
          <input
            type="radio"
            name="student-mode"
            checked={value.mode === 'group'}
            onChange={() => setMode('group')}
          />
          {t('pickers.byGroup')}
        </label>
        <label className="inline">
          <input
            type="radio"
            name="student-mode"
            checked={value.mode === 'selection'}
            onChange={() => setMode('selection')}
          />
          {t('pickers.pickStudents')}
        </label>
      </div>

      {value.mode === 'group' && (
        <GroupFilter
          value={value.groupId ?? ''}
          onChange={(groupId) => onChange({ ...value, groupId: groupId || null })}
        />
      )}

      {selecting && (
        <div className="export-picker">
          <input
            type="search"
            className="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('pickers.searchStudentsPlaceholder')}
            aria-label={t('pickers.searchStudentsLabel')}
          />
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
          {rosterQuery.isPending && (
            <p className="hint">{t('pickers.loadingStudents')}</p>
          )}
          {rosterQuery.isError && (
            <p className="error">{errorMessage(rosterQuery.error)}</p>
          )}
          <div className="columns-list scroll-list">
            {shown.map((student) => (
              <label key={student.id} className="inline">
                <input
                  type="checkbox"
                  checked={selected.has(student.id)}
                  onChange={(event) => toggle(student.id, event.target.checked)}
                />
                {student.fullName}{' '}
                <span className="hint">({student.studentCode})</span>
              </label>
            ))}
            {!rosterQuery.isPending && shown.length === 0 && (
              <p className="hint">{t('pickers.noStudentsMatch')}</p>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}

export default ExportStudentPicker;
