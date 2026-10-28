// The full catalogue of permission keys. These are FIXED in code — admins
// decide which roles hold which keys, but they can never invent a new key.
// Everything the server authorizes against must be one of these strings.

export const PERMISSIONS = [
  // Students
  { key: 'students.view', group: 'Students', label: 'View students' },
  { key: 'students.create', group: 'Students', label: 'Add students' },
  { key: 'students.edit', group: 'Students', label: 'Edit students' },
  { key: 'students.delete', group: 'Students', label: 'Delete students' },

  // Groups
  { key: 'groups.manage', group: 'Groups', label: 'Create and organise groups' },
  { key: 'groups.assign', group: 'Groups', label: 'Put students in groups' },

  // Teachers
  { key: 'teachers.view', group: 'Teachers', label: 'View teachers' },
  { key: 'teachers.manage', group: 'Teachers', label: 'Manage teachers' },

  // Scheduling
  { key: 'schedule.view', group: 'Scheduling', label: 'View the schedule' },
  { key: 'schedule.manage', group: 'Scheduling', label: 'Manage assignments and intervals' },

  // Cafe
  { key: 'cafe.view', group: 'Cafe', label: 'See the cafe pages' },
  { key: 'cafe.sell', group: 'Cafe', label: 'Record cafe sales' },
  { key: 'cafe.balance', group: 'Cafe', label: 'Top up and refund student balances' },
  { key: 'cafe.supplies', group: 'Cafe', label: 'Record purchases and manage suppliers' },
  { key: 'cafe.inventory', group: 'Cafe', label: 'Record waste and adjust stock' },
  { key: 'cafe.manage', group: 'Cafe', label: 'Manage cafe products' },

  // Accounting
  { key: 'accounting.view', group: 'Accounting', label: 'See the journal and reports' },
  { key: 'accounting.enter', group: 'Accounting', label: 'Draft journal entries' },
  { key: 'accounting.post', group: 'Accounting', label: 'Post and void journal entries' },
  { key: 'accounting.close', group: 'Accounting', label: 'Close and reopen fiscal periods' },
  { key: 'accounting.manage', group: 'Accounting', label: 'Manage the chart of accounts and mappings' },

  // AI / voice agent
  { key: 'agent.view', group: 'AI', label: 'See the voice agent panel' },

  // Scores
  { key: 'scores.view', group: 'Scores', label: 'See scores' },
  { key: 'scores.enter', group: 'Scores', label: 'Enter and change scores' },
  { key: 'scores.override', group: 'Scores', label: 'Override locked scores' },

  // Parameters
  { key: 'parameters.view', group: 'Parameters', label: 'See parameters' },
  { key: 'parameters.manage', group: 'Parameters', label: 'Add and edit parameters' },

  // Custom fields
  { key: 'fields.manage', group: 'Custom fields', label: 'Define custom student fields' },
  {
    key: 'fields.view_restricted',
    group: 'Custom fields',
    label: 'See restricted custom fields',
  },

  // Reports
  { key: 'dashboard.view', group: 'Reports', label: 'See the dashboard' },
  { key: 'data.export', group: 'Reports', label: 'Export data to CSV' },
  { key: 'data.import', group: 'Reports', label: 'Import students from CSV' },
  { key: 'views.share', group: 'Reports', label: 'Share saved views with others' },

  // Administration
  { key: 'settings.manage', group: 'Administration', label: 'Change settings' },
  { key: 'users.manage', group: 'Administration', label: 'Manage user accounts' },
  { key: 'roles.manage', group: 'Administration', label: 'Manage roles and permissions' },
  { key: 'audit.view', group: 'Administration', label: 'Read the audit log' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key);
const KEY_SET = new Set(PERMISSION_KEYS);

export function isPermissionKey(value) {
  return typeof value === 'string' && KEY_SET.has(value);
}

// When a key on the left is granted, every key on the right must also be
// granted for the role to make sense. The role editor ticks these
// automatically; the server enforces them so a bad request can never store an
// incoherent role.
export const PREREQUISITES = {
  'students.create': ['students.view'],
  'students.edit': ['students.view'],
  'students.delete': ['students.view'],
  'groups.assign': ['students.view'],
  'groups.manage': ['students.view'],
  'teachers.manage': ['teachers.view'],
  // Scheduling a teacher with a group needs to see both, plus the schedule.
  'schedule.manage': ['schedule.view', 'teachers.view', 'students.view'],
  // Cafe keys build on seeing the cafe. NOTE: cafe.sell deliberately does
  // NOT require students.view — like scores.enter's blind-entry role, the
  // POS exposes only minimal student identity (name, code, balance) so a
  // cashier role can work without access to student records.
  'cafe.sell': ['cafe.view'],
  'cafe.balance': ['cafe.view'],
  'cafe.supplies': ['cafe.view'],
  'cafe.inventory': ['cafe.view'],
  'cafe.manage': ['cafe.view'],
  // The accounting ladder: drafting needs the reports, posting needs the
  // drafting, closing needs posting; managing the chart stands on its own
  // view requirement.
  'accounting.enter': ['accounting.view'],
  'accounting.post': ['accounting.enter'],
  'accounting.close': ['accounting.post'],
  'accounting.manage': ['accounting.view'],
  // NOTE: scores.enter does NOT require scores.view — a "blind entry" role is
  // allowed (it can type scores but the server refuses to read them back).
  // Both scores.view and scores.enter require schedule.view so Results and
  // Evaluate pages can list assignments and sessions.
  'scores.view': ['students.view', 'parameters.view', 'schedule.view'],
  'scores.enter': ['students.view', 'parameters.view', 'schedule.view'],
  'scores.override': ['scores.enter'],
  'parameters.manage': ['parameters.view'],
  'fields.view_restricted': ['students.view'],
  'data.import': ['students.create', 'scores.enter'],
  'data.export': ['students.view', 'scores.view', 'schedule.view'],
};

// Expand a set of chosen keys to include every prerequisite, transitively.
export function withPrerequisites(keys) {
  const result = new Set();
  const visit = (key) => {
    if (!isPermissionKey(key) || result.has(key)) return;
    result.add(key);
    for (const need of PREREQUISITES[key] ?? []) visit(need);
  };
  for (const key of keys) visit(key);
  return [...result];
}

// Which chosen keys are missing a prerequisite (used to reject bad requests
// with a helpful message rather than silently fixing them server-side).
export function missingPrerequisites(keys) {
  const chosen = new Set(keys);
  const missing = [];
  for (const key of chosen) {
    for (const need of PREREQUISITES[key] ?? []) {
      if (!chosen.has(need)) missing.push({ key, needs: need });
    }
  }
  return missing;
}
