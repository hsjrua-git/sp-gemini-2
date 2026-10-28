// Rules that protect the account system from locking everyone out.
//
// `target` has { id, roleId, isActive }.
// `changes` may contain { roleId, isActive, fullName }.
// `guards` describes the critical permissions that must never disappear:
//   [{ key, label, othersActiveWithKey, newRoleHasKey }]
//   - othersActiveWithKey: how many OTHER active users hold this key today
//   - newRoleHasKey: whether the target's role AFTER the change holds it
export function checkUserChange({ actorId, target, changes, guards = [] }) {
  const newRoleId = changes.roleId ?? target.roleId;
  const newActive = changes.isActive ?? target.isActive;

  const roleChanged = newRoleId !== target.roleId;
  const deactivating = target.isActive && newActive === false;

  if (target.id === actorId && (roleChanged || deactivating)) {
    return {
      error:
        'You cannot change your own role or deactivate your own account. Ask another administrator.',
      code: 'USERS_SELF_MODIFY',
    };
  }

  for (const guard of guards) {
    const targetWillHold = newActive && guard.newRoleHasKey;
    const remaining = guard.othersActiveWithKey + (targetWillHold ? 1 : 0);
    if (remaining === 0) {
      return {
        error: `There must always be at least one active user who can ${guard.label}.`,
        code: 'USERS_LAST_MANAGER',
        params: { permission: guard.key },
      };
    }
  }

  return null;
}
