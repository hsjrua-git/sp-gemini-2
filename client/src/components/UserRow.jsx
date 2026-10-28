import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { resetUserPassword, updateUser } from '../api/users.js';
import { listRoles } from '../api/roles.js';
import { formatDateTime } from '../lib/format.js';
import { roleLabel } from '../lib/roleLabels.js';
import { errorMessage } from '../i18n/errors.js';

function UserRow({ user, isSelf, onNotice }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [fullName, setFullName] = useState(user.fullName);
  const [roleId, setRoleId] = useState(user.roleId);

  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: listRoles,
    enabled: isEditing,
  });
  const roles = rolesQuery.data ?? [];

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  const update = useMutation({
    mutationFn: (fields) => updateUser(user.id, fields),
    onSuccess: () => {
      setIsEditing(false);
      refresh();
    },
  });

  const reset = useMutation({
    mutationFn: () => resetUserPassword(user.id),
    onSuccess: (data) => {
      onNotice({
        kind: 'reset',
        username: user.username,
        temporaryPassword: data.temporaryPassword,
      });
      refresh();
    },
  });

  function startEditing() {
    setFullName(user.fullName);
    setRoleId(user.roleId);
    update.reset();
    setIsEditing(true);
  }

  function handleSave() {
    const fields = {};
    if (fullName.trim().replace(/\s+/g, ' ') !== user.fullName) {
      fields.fullName = fullName;
    }
    if (roleId !== user.roleId) fields.roleId = roleId;

    if (Object.keys(fields).length === 0) {
      setIsEditing(false);
      return;
    }
    update.mutate(fields);
  }

  function handleToggleActive() {
    if (user.isActive) {
      const ok = window.confirm(
        t('users.row.deactivateConfirm', { name: user.username })
      );
      if (!ok) return;
    }
    update.mutate({ isActive: !user.isActive });
  }

  function handleReset() {
    const ok = window.confirm(
      t('users.row.resetConfirm', { name: user.username })
    );
    if (ok) reset.mutate();
  }

  return (
    <tr className={user.isActive ? undefined : 'inactive'}>
      <td>
        {user.username}
        {isSelf && <span className="hint"> {t('users.row.you')}</span>}
      </td>
      <td>
        {isEditing ? (
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={100}
            aria-label={t('users.row.fullNameLabel', { name: user.username })}
            autoComplete="off"
          />
        ) : (
          user.fullName
        )}
      </td>
      <td>
        {isEditing ? (
          <select
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            disabled={isSelf}
            aria-label={t('users.row.roleLabel', { name: user.username })}
          >
            {/* Keep the current role visible even before the list loads. */}
            {roles.length === 0 && (
              <option value={user.roleId}>{user.role}</option>
            )}
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        ) : (
          roleLabel(user.role)
        )}
      </td>
      <td>
        <span className={user.isActive ? 'badge ok' : 'badge'}>
          {user.isActive ? t('users.row.active') : t('users.row.inactive')}
        </span>
        {user.mustChangePassword && (
          <div className="hint">{t('users.row.mustChangePassword')}</div>
        )}
      </td>
      <td className="nowrap">
        {user.lastLoginAt
          ? formatDateTime(user.lastLoginAt)
          : t('users.row.never')}
      </td>
      <td className="actions">
        {isEditing ? (
          <>
            <button type="button" onClick={handleSave} disabled={update.isPending}>
              {t('common:actions.save')}
            </button>
            <button type="button" onClick={() => setIsEditing(false)}>
              {t('common:actions.cancel')}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={startEditing}>
              {t('common:actions.edit')}
            </button>
            {!isSelf && (
              <>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={reset.isPending}
                >
                  {t('users.row.resetPassword')}
                </button>
                <button
                  type="button"
                  className={user.isActive ? 'danger' : undefined}
                  onClick={handleToggleActive}
                  disabled={update.isPending}
                >
                  {user.isActive
                    ? t('users.row.deactivate')
                    : t('users.row.reactivate')}
                </button>
              </>
            )}
          </>
        )}
        {update.isError && (
          <p className="error">{errorMessage(update.error)}</p>
        )}
        {reset.isError && <p className="error">{errorMessage(reset.error)}</p>}
      </td>
    </tr>
  );
}

export default UserRow;
