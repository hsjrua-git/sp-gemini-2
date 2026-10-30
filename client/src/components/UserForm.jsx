import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { createUser } from '../api/users.js';
import { listRoles } from '../api/roles.js';
import { errorMessage } from '../i18n/errors.js';

function UserForm({ onNotice }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleId, setRoleId] = useState('');

  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const roles = rolesQuery.data ?? [];

  // The effective selection is the user's explicit pick, or — until they touch
  // the dropdown — the first role in the list. Deriving it during render (rather
  // than defaulting via an effect) avoids an extra render pass and the
  // set-state-in-effect anti-pattern.
  const selectedRoleId = roleId || roles[0]?.id || '';

  const mutation = useMutation({
    mutationFn: createUser,
    onSuccess: (data) => {
      setUsername('');
      setFullName('');
      setRoleId('');
      onNotice({
        kind: 'created',
        username: data.user.username,
        temporaryPassword: data.temporaryPassword,
      });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    mutation.mutate({ username, fullName, roleId: selectedRoleId });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-grid">
        <label>
          {t('users.form.username')}
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={t('users.form.usernamePlaceholder')}
            maxLength={32}
            autoComplete="off"
          />
        </label>
        <label>
          {t('users.form.fullName')}
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={100}
            autoComplete="off"
          />
        </label>
        <label>
          {t('users.form.role')}
          <select
            value={selectedRoleId}
            onChange={(event) => setRoleId(event.target.value)}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="submit" disabled={mutation.isPending || selectedRoleId === ''}>
        {mutation.isPending
          ? t('users.form.creating')
          : t('users.form.submit')}
      </button>
      {mutation.isError && (
        <p className="error" role="alert">
          {errorMessage(mutation.error)}
        </p>
      )}
    </form>
  );
}

export default UserForm;
