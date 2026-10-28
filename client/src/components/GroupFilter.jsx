import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listGroups } from '../api/groups.js';

// Build the same indented, tree-ordered list the Groups page uses.
function orderTree(groups) {
  const byParent = new Map();
  for (const group of groups) {
    const key = group.parentId ?? 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(group);
  }
  const walk = (parentKey, depth) =>
    (byParent.get(parentKey) ?? []).flatMap((group) => [
      { ...group, depth },
      ...walk(group.id, depth + 1),
    ]);
  return walk('root', 0);
}

// A dropdown that lets the user narrow a page to one group (and its subgroups).
function GroupFilter({ value, onChange, label }) {
  const { t } = useTranslation(['reports', 'common']);
  const { data } = useQuery({ queryKey: ['groups'], queryFn: () => listGroups() });
  const ordered = useMemo(() => (data ? orderTree(data) : []), [data]);

  if (ordered.length === 0) return null;

  return (
    <label className="group-filter">
      {label ?? t('groupFilter.label')}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('shared.allStudents')}</option>
        {ordered.map((group) => (
          <option key={group.id} value={group.id}>
            {'  '.repeat(group.depth)}
            {group.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default GroupFilter;
