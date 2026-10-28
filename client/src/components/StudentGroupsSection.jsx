import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listGroups,
  listStudentGroups,
  updateGroupMembers,
} from '../api/groups.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';

function StudentGroupsSection({ student }) {
  const { t } = useTranslation(['students', 'common']);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canAssign = can('groups.assign');
  const [choice, setChoice] = useState('');

  const memberOfQuery = useQuery({
    queryKey: ['student-groups', student.id],
    queryFn: () => listStudentGroups(student.id),
  });
  const allGroupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: () => listGroups(),
    enabled: canAssign,
  });

  const memberOf = memberOfQuery.data ?? [];
  const memberIds = new Set(memberOf.map((group) => group.id));
  const available = (allGroupsQuery.data ?? []).filter(
    (group) => !memberIds.has(group.id)
  );

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['student-groups', student.id] });
  }

  const add = useMutation({
    mutationFn: (groupId) => updateGroupMembers(groupId, { add: [student.id] }),
    onSuccess: () => {
      setChoice('');
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (groupId) =>
      updateGroupMembers(groupId, { remove: [student.id] }),
    onSuccess: invalidate,
  });

  if (memberOfQuery.isError) {
    return (
      <section className="section-card">
        <h2>{t('detail.groupsTitle')}</h2>
        <p className="error">{errorMessage(memberOfQuery.error)}</p>
      </section>
    );
  }

  const busy = add.isPending || remove.isPending;

  return (
    <section className="section-card">
      <h2>{t('detail.groupsTitle')}</h2>
      {memberOf.length === 0 ? (
        <p className="hint">{t('detail.notInGroup')}</p>
      ) : (
        <span className="chip-row">
          {memberOf.map((group) => (
            <span key={group.id} className="chip brand">
              {group.name}
              {canAssign && (
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => remove.mutate(group.id)}
                  disabled={busy}
                  aria-label={t('detail.removeFromGroup', { name: group.name })}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </span>
      )}

      {canAssign && available.length > 0 && (
        <div className="row">
          <label htmlFor={`add-group-${student.id}`} className="sr-only">
            {t('detail.addToGroupLabel')}
          </label>
          <select
            id={`add-group-${student.id}`}
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            disabled={busy}
          >
            <option value="">{t('detail.addToGroupPlaceholder')}</option>
            {available.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => choice && add.mutate(choice)}
            disabled={!choice || busy}
          >
            {t('common:actions.add')}
          </button>
        </div>
      )}

      {add.isError && <p className="error">{errorMessage(add.error)}</p>}
      {remove.isError && <p className="error">{errorMessage(remove.error)}</p>}
    </section>
  );
}

export default StudentGroupsSection;
