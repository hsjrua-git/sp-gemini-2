import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listGroups } from '../api/groups.js';
import { hierarchy, hierarchyLabel } from '../lib/hierarchy.js';

// Build the same indented, tree-ordered list the Groups page uses.

// A dropdown that lets the user narrow a page to one group (and its subgroups).
function GroupFilter({ value, onChange, label }) {
  const { t } = useTranslation(['reports', 'common']);
  const { data } = useQuery({ queryKey: ['groups'], queryFn: () => listGroups() });
  const ordered = useMemo(() => hierarchy(data ?? []), [data]);

  if (ordered.length === 0) return null;

  return (
    <label className="group-filter">
      {label ?? t('groupFilter.label')}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('shared.allStudents')}</option>
        {ordered.map((group) => (
          <option key={group.id} value={group.id}>
            {hierarchyLabel(group)}
          </option>
        ))}
      </select>
    </label>
  );
}

export default GroupFilter;
