// Single-user identity for the on-device build.
//
// The web app derived `req.user` (id, username, permissions) from the session
// on every request and gated each action with permission keys. The mobile build
// has exactly one person, who owns the device and the data — effectively the
// administrator — so there is nothing to gate against.
//
// Two things the routes used are collapsed here:
//   * userCan(req, key)  ->  always true (CAN_SEE_RESTRICTED and friends).
//   * req.user.id / .username  ->  a single local user, resolved at startup.
//
// audit_log.user_id is a NULLABLE FK, so before the local user is resolved,
// getLocalActor() still returns a usable actor (null id + 'local' label) and
// audit inserts succeed. But user_preferences.user_id and saved_views.user_id
// are NOT NULL FKs, so those services require a real id — call ensureLocalUser()
// (core/bootstrap.js) once at startup (and in tests that touch them). Until then
// getLocalUserId() throws, which is a programming error, not a user-facing one.

// The single user is the admin, so restricted custom-field values are always
// visible and every permission check resolves to true.
export const CAN_SEE_RESTRICTED = true;

let localUser = { id: null, username: 'local' };

// Record the resolved local user (see ensureLocalUser in bootstrap.js).
export function setLocalUser({ id, username = 'local' }) {
  localUser = { id, username };
}

// For the audit trail: a { userId, actor } pair. userId may be null before the
// local user is resolved; audit_log tolerates that.
export function getLocalActor() {
  return { userId: localUser.id, actor: localUser.username };
}

// For rows that REQUIRE a user id (preferences, saved views). Throws if the
// local user has not been resolved yet.
export function getLocalUserId() {
  if (!localUser.id) {
    throw new Error(
      'Local user not initialised — call ensureLocalUser(db) at startup.',
    );
  }
  return localUser.id;
}

// Mostly for tests that spin up and tear down repeatedly.
export function resetLocalUser() {
  localUser = { id: null, username: 'local' };
}
