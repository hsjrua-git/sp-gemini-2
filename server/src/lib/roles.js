export const ROLES = ['viewer', 'staff', 'admin'];

const LEVEL = { viewer: 1, staff: 2, admin: 3 };

export function isRole(value) {
  return typeof value === 'string' && Object.hasOwn(LEVEL, value);
}

export function hasAtLeast(role, minRole) {
  if (!isRole(role) || !isRole(minRole)) return false;
  return LEVEL[role] >= LEVEL[minRole];
}

export function minRoleFor(policy, method) {
  const name = method === 'HEAD' ? 'GET' : method;
  return Object.hasOwn(policy, name) ? policy[name] : null;
}