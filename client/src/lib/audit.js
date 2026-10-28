import { formatIsoDate, formatStudentCode } from './format.js';

export const CATEGORY_OPTIONS = [
  { value: '' },
  { value: 'scores' },
  { value: 'student' },
  { value: 'teacher' },
  { value: 'interval' },
  { value: 'assignment' },
  { value: 'session' },
  { value: 'task' },
  { value: 'task_template' },
  { value: 'alert' },
  { value: 'parameter' },
  { value: 'parameter_change' },
  { value: 'cafe_product' },
  { value: 'cafe_supplier' },
  { value: 'cafe_purchase' },
  { value: 'cafe_sale' },
  { value: 'cafe_inventory' },
  { value: 'cafe_balance' },
  { value: 'accounting' },
  { value: 'accounting_period' },
  { value: 'agent' },
  { value: 'settings' },
  { value: 'user' },
  { value: 'role' },
  { value: 'group' },
  { value: 'field' },
  { value: 'auth' },
  { value: 'api' },
];

function withCode(code) {
  return code ? ` (${formatStudentCode(code)})` : '';
}

// Turns one audit entry into translation-ready segments: { key, params }
// pairs resolved against the admin namespace's audit.actions.* keys at the
// render site (AuditPage). The page falls back to the raw action code when
// a key is missing, so actions this switch does not know about — and future
// ones the server adds — never render a bare translation key. Action codes
// and detail fields are data and stay untranslated; only the sentence
// templates live in the locale files. Most actions are a single segment;
// composite ones (a save with an override, a user update touching several
// fields) return several, joined by the translated audit.joiner.
export function describeAudit(entry) {
  const details = entry.details ?? {};
  const result = details.result ?? {};
  const request = details.request ?? {};

  switch (entry.action) {
    case 'student.create':
      return [
        {
          key: 'student.create',
          params: {
            name: result.fullName ?? request.fullName ?? '',
            code: withCode(result.studentCode),
          },
        },
      ];
    case 'student.update':
      return [
        {
          key: 'student.update',
          params: {
            name: result.fullName ?? request.fullName ?? '?',
            code: withCode(result.studentCode),
          },
        },
      ];
    case 'student.delete':
      return entry.studentName
        ? [
            {
              key: 'student.deleteNamed',
              params: {
                name: entry.studentName,
                code: withCode(entry.studentCode),
              },
            },
          ]
        : [{ key: 'student.deleteUnnamed' }];
    case 'parameter.create':
      return [
        {
          key: 'parameter.create',
          params: {
            name: result.name ?? request.name ?? '?',
            period: request.startPeriod ?? '?',
          },
        },
      ];
    case 'parameter.update':
      return [
        {
          key: 'parameter.update',
          params: { name: entry.parameterName ?? result.name ?? '?' },
        },
      ];
    case 'parameter_change.create': {
      const name = entry.changeParameterName ?? '?';
      const verb = result.action === 'add' ? 'add' : 'remove';
      const scope =
        result.scope === 'this_period_only' ? 'thisPeriod' : 'fromHereOn';
      return [
        {
          key: `parameter_change.create.${verb}.${scope}`,
          params: { name, periodNumber: result.periodNumber ?? '?' },
        },
      ];
    }
    case 'parameter_change.delete':
      return [{ key: 'parameter_change.delete' }];
    case 'settings.period_anchor': {
      const anchor = result.anchorDate ?? request.anchorDate;
      return [
        {
          key: 'settings.period_anchor',
          params: { date: anchor ? formatIsoDate(anchor) : '?' },
        },
      ];
    }
    case 'scores.save': {
      const count = details.count ?? 0;
      const segments = [
        {
          key:
            details.source === 'import'
              ? 'scores.save.imported'
              : 'scores.save.saved',
          params: {
            count,
            sessionCode: details.sessionCode ?? details.assignmentCode ?? '?',
          },
        },
      ];
      if (details.overrideReason) {
        segments.push({
          key: 'scores.save.overrideSuffix',
          params: { reason: details.overrideReason },
        });
      }
      return segments;
    }
    case 'auth.login':
      return [{ key: 'auth.login' }];
    case 'auth.login_failed':
      return [
        {
          key: 'auth.login_failed',
          params: { username: details.attemptedUsername ?? '?' },
        },
      ];
    case 'auth.logout':
      return [{ key: 'auth.logout' }];
    case 'auth.password_change':
      return [{ key: 'auth.password_change' }];
    case 'api.change':
      return [
        {
          key: 'api.change',
          params: { method: details.method ?? '', path: details.path ?? '' },
        },
      ];
    case 'user.create':
      return [
        {
          key: 'user.create',
          params: {
            role: details.role ?? '',
            username: details.username ?? '?',
            fullName: details.fullName ?? '',
          },
        },
      ];
    case 'user.update': {
      const changes = details.changes ?? {};
      const segments = [
        { key: 'user.update', params: { username: details.username ?? '?' } },
      ];
      if (changes.role) {
        segments.push({
          key: 'user.updateRole',
          params: { from: changes.role.from, to: changes.role.to },
        });
      }
      if (changes.isActive) {
        segments.push({
          key: changes.isActive.to
            ? 'user.updateReactivated'
            : 'user.updateDeactivated',
        });
      }
      if (changes.fullName) {
        segments.push({
          key: 'user.updateRenamed',
          params: { name: changes.fullName.to },
        });
      }
      if (segments.length === 1) segments.push({ key: 'user.updateNone' });
      return segments;
    }
    case 'user.password_reset':
      return [
        {
          key: 'user.password_reset',
          params: { username: details.username ?? '?' },
        },
      ];
    case 'role.create':
      return [{ key: 'role.create', params: { name: details.name ?? '?' } }];
    case 'role.update':
      return details.renamedFrom
        ? [
            {
              key: 'role.updateRenamed',
              params: { from: details.renamedFrom, name: details.name ?? '?' },
            },
          ]
        : [{ key: 'role.update', params: { name: details.name ?? '?' } }];
    case 'role.delete':
      return [{ key: 'role.delete', params: { name: details.name ?? '?' } }];
    case 'group.create':
      return [{ key: 'group.create', params: { name: details.name ?? '?' } }];
    case 'group.update':
      return [{ key: 'group.update', params: { name: details.name ?? '?' } }];
    case 'group.archive':
      return [{ key: 'group.archive', params: { name: details.name ?? '?' } }];
    case 'group.members': {
      const name = details.name ?? '?';
      const segments = [{ key: 'group.members', params: { name } }];
      if (details.added) {
        segments.push({
          key: 'group.membersAdded',
          params: { count: details.added },
        });
      }
      if (details.removed) {
        segments.push({
          key: 'group.membersRemoved',
          params: { count: details.removed },
        });
      }
      return segments.length > 1
        ? segments
        : [{ key: 'group.membersNone', params: { name } }];
    }
    case 'field.create':
      return [{ key: 'field.create', params: { label: details.label ?? '?' } }];
    case 'field.update':
      return [{ key: 'field.update', params: { label: details.label ?? '?' } }];
    case 'field.archive':
      return [{ key: 'field.archive', params: { label: details.label ?? '?' } }];
    case 'student.import': {
      const count = details.count ?? 0;
      const skipped = details.skipped ?? 0;
      const segments = [{ key: 'student.import', params: { count } }];
      if (skipped > 0) {
        segments.push({
          key: 'student.importSkipped',
          params: { count: skipped },
        });
      }
      return segments;
    }
    case 'session.generate':
      return [
        {
          key: 'session.generate',
          params: {
            count: details.created ?? 0,
            until: details.until ? formatIsoDate(details.until) : '?',
          },
        },
      ];
    case 'session.update':
    case 'teacher.create':
    case 'teacher.update':
    case 'teacher.archive':
    case 'interval.create':
    case 'interval.update':
    case 'interval.archive':
    case 'assignment.create':
    case 'assignment.update':
    case 'assignment.archive':
    case 'task.create':
    case 'task.update':
    case 'task.delete':
    case 'task.assign_template':
    case 'task_template.create':
    case 'task_template.update':
    case 'task_template.archive':
    case 'alert.update':
      return [{ key: entry.action }];
    case 'alert.scan':
      return [
        {
          key: 'alert.scan',
          params: {
            raised: details.raised ?? 0,
            resolved: details.resolved ?? 0,
          },
        },
      ];
    case 'cafe_product.create':
      return [
        {
          key: 'cafe_product.create',
          params: { name: details.name ?? '?' },
        },
      ];
    case 'cafe_product.update':
      return [
        {
          key: 'cafe_product.update',
          params: { name: details.name ?? details.id ?? '?' },
        },
      ];
    case 'cafe_supplier.create':
      return [
        {
          key: 'cafe_supplier.create',
          params: { name: details.name ?? '?' },
        },
      ];
    case 'cafe_supplier.update':
      return [
        {
          key: 'cafe_supplier.update',
          params: { name: details.name ?? details.id ?? '?' },
        },
      ];
    case 'cafe_purchase.create':
      return [
        {
          key: 'cafe_purchase.create',
          params: {
            total: details.total ?? 0,
            lineCount: details.lineCount ?? 0,
          },
        },
      ];
    case 'cafe_sale.create':
      return [
        {
          key: 'cafe_sale.create',
          params: {
            total: details.total ?? 0,
            lineCount: details.lineCount ?? 0,
          },
        },
      ];
    case 'cafe_sale.void':
      return [
        {
          key: 'cafe_sale.void',
          params: { total: details.total ?? 0 },
        },
      ];
    case 'cafe_waste.create':
      return [
        {
          key: 'cafe_waste.create',
          params: {
            qty: details.qty ?? 0,
            costValue: details.costValue ?? 0,
          },
        },
      ];
    case 'cafe_adjustment.create':
      return [
        {
          key: 'cafe_adjustment.create',
          params: { qty: details.qty ?? 0 },
        },
      ];
    case 'cafe_balance.topup':
    case 'cafe_balance.refund':
    case 'cafe_balance.adjustment':
      return [
        {
          key: entry.action,
          params: {
            amount: details.amount ?? 0,
            balanceAfter: details.balanceAfter ?? 0,
          },
        },
      ];
    case 'accounting_account.create':
      return [
        {
          key: 'accounting_account.create',
          params: {
            code: details.code ?? '?',
            name: details.name ?? '?',
          },
        },
      ];
    case 'accounting_account.update':
      return [
        {
          key: 'accounting_account.update',
          params: { id: details.id ?? '?' },
        },
      ];
    case 'accounting_mapping.update':
      return [
        {
          key: 'accounting_mapping.update',
          params: { eventKey: details.eventKey ?? '?' },
        },
      ];
    case 'accounting_entry.create':
      return [
        {
          key: 'accounting_entry.create',
          params: {
            entryNumber: details.entryNumber ?? '?',
            status: details.status ?? '',
          },
        },
      ];
    case 'accounting_entry.update':
      return [
        {
          key: 'accounting_entry.update',
          params: { id: details.id ?? '?' },
        },
      ];
    case 'accounting_entry.post':
      return [
        {
          key: 'accounting_entry.post',
          params: { id: details.id ?? '?' },
        },
      ];
    case 'accounting_entry.void':
      return [
        {
          key: 'accounting_entry.void',
          params: {
            id: details.id ?? '?',
            reason: details.reason ?? '',
          },
        },
      ];
    case 'accounting_entry.delete':
      return [
        {
          key: 'accounting_entry.delete',
          params: { id: details.id ?? '?' },
        },
      ];
    case 'accounting.opening_balance':
      return [
        {
          key: 'accounting.opening_balance',
          params: { entryNumber: details.entryNumber ?? '?' },
        },
      ];
    case 'accounting_period.create':
      return [
        {
          key: 'accounting_period.create',
          params: { name: details.name ?? '?' },
        },
      ];
    case 'accounting_period.close':
      return [
        {
          key: 'accounting_period.close',
          params: {
            name: details.name ?? '?',
            netIncome: details.netIncome ?? 0,
          },
        },
      ];
    default:
      return [{ key: entry.action }];
  }
}
