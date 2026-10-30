// Roles are now configurable and come from the server, so there is no fixed
// list of options here. The display label is simply the role's name.
export function roleLabel(role) {
  return role ?? 'No role';
}
