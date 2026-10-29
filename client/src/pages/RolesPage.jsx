import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import {
  createRole,
  deleteRole,
  fetchPermissionCatalog,
  listRoles,
  updateRole,
} from '../api/roles.js';
import { errorMessage } from '../i18n/errors.js';

// The built-in Administrator is the one system role that can manage roles.
// It is locked everywhere (no edit, rename, or delete) so an installation can
// never strip its own last set of admin powers. Other system roles (Staff,
// Viewer) stay fully editable.
function isAdminRole(role) {
  return role.isSystem && role.permissions.includes('roles.manage');
}

// Expand a chosen set to include every prerequisite (transitively).
function addWithPrerequisites(keys, key, prerequisites) {
  const next = new Set(keys);
  const visit = (k) => {
    if (next.has(k)) return;
    next.add(k);
    for (const need of prerequisites[k] ?? []) visit(need);
  };
  visit(key);
  return next;
}

// Remove a key and anything that depends on it (transitively).
function removeWithDependents(keys, key, prerequisites) {
  const next = new Set(keys);
  const dependsOn = (candidate, target, seen = new Set()) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return (prerequisites[candidate] ?? []).some(
      (need) => need === target || dependsOn(need, target, seen)
    );
  };
  next.delete(key);
  for (const other of [...next]) {
    if (dependsOn(other, key)) next.delete(other);
  }
  return next;
}

function PermissionEditor({ catalog, selected, onToggle, disabled }) {
  const { t } = useTranslation(['admin', 'common']);
  const groups = useMemo(() => {
    const byGroup = new Map();
    for (const permission of catalog.permissions) {
      if (!byGroup.has(permission.group)) byGroup.set(permission.group, []);
      byGroup.get(permission.group).push(permission);
    }
    return [...byGroup.entries()];
  }, [catalog]);

  return (
    <div className="permission-grid">
      {groups.map(([group, permissions]) => (
        <fieldset key={group}>
          <legend>
            {t(`permissionGroups.${group}`, { defaultValue: group })}
          </legend>
          {permissions.map((permission) => (
            <label key={permission.key} className="checkbox-row">
              <input
                type="checkbox"
                checked={selected.has(permission.key)}
                disabled={disabled}
                onChange={(event) =>
                  onToggle(permission.key, event.target.checked)
                }
              />
              <span>
                {t(`permissions.${permission.key}`, {
                  defaultValue: permission.label,
                })}
              </span>
              <code className="hint">{permission.key}</code>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function RoleEditor({ catalog, role, onDone }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const isNew = role === null;
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState(
    () => new Set(role?.permissions ?? [])
  );

  const save = useMutation({
    mutationFn: (payload) =>
      isNew ? createRole(payload) : updateRole(role.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      onDone();
    },
  });

  function toggle(key, checked) {
    setSelected((current) =>
      checked
        ? addWithPrerequisites(current, key, catalog.prerequisites)
        : removeWithDependents(current, key, catalog.prerequisites)
    );
  }

  function handleSubmit(event) {
    event.preventDefault();
    save.mutate({
      name,
      description,
      permissions: [...selected],
    });
  }

  return (
    <form onSubmit={handleSubmit} className="role-editor">
      <div className="form-grid">
        <label>
          {t('roles.editor.name')}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={50}
            autoComplete="off"
          />
        </label>
        <label>
          {t('roles.editor.description')}
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={200}
            autoComplete="off"
          />
        </label>
      </div>

      {role?.isSystem && (
        <p className="hint">
          {isAdminRole(role)
            ? t('roles.editor.adminLocked')
            : t('roles.editor.systemEditable')}
        </p>
      )}

      <PermissionEditor
        catalog={catalog}
        selected={selected}
        onToggle={toggle}
      />

      <div className="toolbar">
        <button
          type="submit"
          className="primary"
          disabled={save.isPending || name.trim() === ''}
        >
          {save.isPending
            ? t('common:actions.saving')
            : isNew
              ? t('roles.editor.create')
              : t('roles.editor.save')}
        </button>
        <button type="button" onClick={onDone}>
          {t('common:actions.cancel')}
        </button>
      </div>
      {save.isError && (
        <p className="error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
    </form>
  );
}

function RolesPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null); // role object, or 'new', or null

  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const catalogQuery = useQuery({
    queryKey: ['role-catalog'],
    queryFn: fetchPermissionCatalog,
  });

  const remove = useMutation({
    mutationFn: (id) => deleteRole(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roles'] }),
  });

  if (!can('roles.manage')) {
    return (
      <main>
        <EmptyState
          title={t('roles.readOnlyTitle')}
          description={t('roles.readOnlyDescription')}
        />
      </main>
    );
  }

  if (rolesQuery.isPending || catalogQuery.isPending) {
    return (
      <main aria-busy="true">
        <div className="page-loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <p>{t('common:status.loading')}</p>
        </div>
      </main>
    );
  }
  if (rolesQuery.isError || catalogQuery.isError) {
    return (
      <main>
        <EmptyState
          tone="danger"
          title={t('roles.loadErrorTitle')}
          description={errorMessage(rolesQuery.error ?? catalogQuery.error)}
        />
      </main>
    );
  }

  const catalog = catalogQuery.data;

  function handleDelete(role) {
    if (window.confirm(t('roles.deleteConfirm', { name: role.name }))) {
      remove.mutate(role.id);
    }
  }

  return (
    <main className="wide">
      <div className="page-head">
        <h1>{t('roles.title')}</h1>
        {editing === null && (
          <div className="page-head-actions">
            <button
              type="button"
              className="primary"
              onClick={() => setEditing('new')}
            >
              {t('roles.newRole')}
            </button>
          </div>
        )}
      </div>
      <p className="hint">{t('roles.hint')}</p>

      {editing === null ? (
        <section className="section-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('roles.colRole')}</th>
                  <th>{t('roles.colDescription')}</th>
                  <th>{t('roles.colPermissions')}</th>
                  <th>{t('roles.colPeople')}</th>
                  <th>{t('common:table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rolesQuery.data.map((role) => (
                  <tr key={role.id}>
                    <td>
                      {role.name}
                      {role.isSystem && (
                        <span className="badge">{t('roles.builtIn')}</span>
                      )}
                    </td>
                    <td>{role.description || '—'}</td>
                    <td>{role.permissions.length}</td>
                    <td>{role.userCount}</td>
                    <td className="actions">
                      {isAdminRole(role) ? (
                        <span className="hint">{t('roles.locked')}</span>
                      ) : (
                        <>
                          <button type="button" onClick={() => setEditing(role)}>
                            {t('common:actions.edit')}
                          </button>
                          {!role.isSystem && (
                            <button
                              type="button"
                              className="danger"
                              onClick={() => handleDelete(role)}
                              disabled={role.userCount > 0 || remove.isPending}
                              title={
                                role.userCount > 0
                                  ? t('roles.deleteBlocked')
                                  : undefined
                              }
                            >
                              {t('common:actions.delete')}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {remove.isError && (
            <p className="error" role="alert">
              {errorMessage(remove.error)}
            </p>
          )}
        </section>
      ) : (
        <section className="section-card">
          <h2>
            {editing === 'new'
              ? t('roles.newRole')
              : t('roles.editRole', { name: editing.name })}
          </h2>
          <RoleEditor
            catalog={catalog}
            role={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        </section>
      )}
    </main>
  );
}

export default RolesPage;
