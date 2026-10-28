import { isUuid } from './ids.js';

const MAX_JSON_LENGTH = 2000;
const SECRET_KEY = /pass|secret|token|hash/i;

const RULES = [
  { method: 'POST', pattern: /^\/api\/students$/, action: 'student.create', entityType: 'student' },
  { method: 'PATCH', pattern: /^\/api\/students\/[^/]+$/, action: 'student.update', entityType: 'student' },
  { method: 'DELETE', pattern: /^\/api\/students\/[^/]+$/, action: 'student.delete', entityType: 'student' },
  { method: 'POST', pattern: /^\/api\/teachers$/, action: 'teacher.create', entityType: 'teacher' },
  { method: 'PATCH', pattern: /^\/api\/teachers\/[^/]+$/, action: 'teacher.update', entityType: 'teacher' },
  { method: 'DELETE', pattern: /^\/api\/teachers\/[^/]+$/, action: 'teacher.archive', entityType: 'teacher' },
  { method: 'POST', pattern: /^\/api\/intervals$/, action: 'interval.create', entityType: 'interval' },
  { method: 'PATCH', pattern: /^\/api\/intervals\/[^/]+$/, action: 'interval.update', entityType: 'interval' },
  { method: 'DELETE', pattern: /^\/api\/intervals\/[^/]+$/, action: 'interval.archive', entityType: 'interval' },
  { method: 'POST', pattern: /^\/api\/assignments$/, action: 'assignment.create', entityType: 'assignment' },
  { method: 'PATCH', pattern: /^\/api\/assignments\/[^/]+$/, action: 'assignment.update', entityType: 'assignment' },
  { method: 'DELETE', pattern: /^\/api\/assignments\/[^/]+$/, action: 'assignment.archive', entityType: 'assignment' },
  { method: 'PATCH', pattern: /^\/api\/sessions\/[^/]+$/, action: 'session.update', entityType: 'session' },
  { method: 'POST', pattern: /^\/api\/tasks$/, action: 'task.create', entityType: 'task' },
  { method: 'PATCH', pattern: /^\/api\/tasks\/[^/]+$/, action: 'task.update', entityType: 'task' },
  { method: 'DELETE', pattern: /^\/api\/tasks\/[^/]+$/, action: 'task.delete', entityType: 'task' },
  { method: 'POST', pattern: /^\/api\/task-templates$/, action: 'task_template.create', entityType: 'task_template' },
  { method: 'PATCH', pattern: /^\/api\/task-templates\/[^/]+$/, action: 'task_template.update', entityType: 'task_template' },
  { method: 'DELETE', pattern: /^\/api\/task-templates\/[^/]+$/, action: 'task_template.archive', entityType: 'task_template' },
  { method: 'PATCH', pattern: /^\/api\/alerts\/[^/]+$/, action: 'alert.update', entityType: 'alert' },
  { method: 'POST', pattern: /^\/api\/accounting\/accounts$/, action: 'accounting_account.create', entityType: 'acct_account' },
  { method: 'POST', pattern: /^\/api\/accounting\/periods$/, action: 'accounting_period.create', entityType: 'acct_fiscal_period' },
  { method: 'PATCH', pattern: /^\/api\/accounting\/accounts\/[^/]+$/, action: 'accounting_account.update', entityType: 'acct_account' },
  { method: 'DELETE', pattern: /^\/api\/accounting\/accounts\/[^/]+$/, action: 'accounting_account.deactivate', entityType: 'acct_account' },
  { method: 'PATCH', pattern: /^\/api\/accounting\/mappings\/[^/]+$/, action: 'accounting_mapping.update', entityType: 'acct_mapping' },
  { method: 'PATCH', pattern: /^\/api\/accounting\/periods\/[^/]+$/, action: 'accounting_period.update', entityType: 'acct_fiscal_period' },
  { method: 'POST', pattern: /^\/api\/cafe\/products$/, action: 'cafe_product.create', entityType: 'cafe_product' },
  { method: 'PATCH', pattern: /^\/api\/cafe\/products\/[^/]+$/, action: 'cafe_product.update', entityType: 'cafe_product' },
  { method: 'DELETE', pattern: /^\/api\/cafe\/products\/[^/]+$/, action: 'cafe_product.deactivate', entityType: 'cafe_product' },
  { method: 'POST', pattern: /^\/api\/cafe\/suppliers$/, action: 'cafe_supplier.create', entityType: 'cafe_supplier' },
  { method: 'PATCH', pattern: /^\/api\/cafe\/suppliers\/[^/]+$/, action: 'cafe_supplier.update', entityType: 'cafe_supplier' },
  { method: 'DELETE', pattern: /^\/api\/cafe\/suppliers\/[^/]+$/, action: 'cafe_supplier.deactivate', entityType: 'cafe_supplier' },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/, action: 'auth.logout', entityType: 'user' },
  { method: 'POST', pattern: /^\/api\/auth\/change-password$/, action: 'auth.password_change', entityType: 'user' },
];

const RECORDED_BY_THEIR_OWN_ROUTES = [
  /^\/api\/evaluations\/bulk$/,
  /^\/api\/users(\/|$)/,
  /^\/api\/preferences$/,
  /^\/api\/saved-views(\/|$)/,
  // POST is supported only to carry a large read-only export filter body.
  /^\/api\/export\/cube$/,
  /^\/api\/students\/import$/,
  /^\/api\/roles(\/|$)/,
  /^\/api\/groups(\/|$)/,
  /^\/api\/field-definitions(\/|$)/,
  /^\/api\/sessions\/generate$/,
  /^\/api\/tasks\/from-template$/,
  /^\/api\/alerts\/scan$/,
  /^\/api\/parameters(\/|$)/,
  /^\/api\/cafe\/purchases$/,
  /^\/api\/cafe\/sales(\/|$)/,
  /^\/api\/cafe\/balances$/,
  /^\/api\/cafe\/inventory$/,
  /^\/api\/accounting\/journal(\/|$)/,
  /^\/api\/accounting\/periods\/[^/]+\/(close|reopen)$/,
  /^\/api\/accounting\/periods\/opening$/,
];

export function normalisePath(url) {
  return url.split('?')[0].replace(/\/+$/, '').toLowerCase();
}

export function classifyRequest(method, path, status) {
  if (method === 'POST' && path === '/api/auth/login') {
    if (status === 200) return { action: 'auth.login', entityType: 'user' };
    if (status === 401) return { action: 'auth.login_failed', entityType: 'user' };
    return null;
  }
  if (status < 200 || status >= 300) return null;
  if (RECORDED_BY_THEIR_OWN_ROUTES.some((pattern) => pattern.test(path))) {
    return null;
  }

  const rule = RULES.find(
    (item) => item.method === method && item.pattern.test(path)
  );
  if (rule) return { action: rule.action, entityType: rule.entityType };
  return { action: 'api.change', entityType: null };
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        SECRET_KEY.test(key) ? '[hidden]' : redact(inner),
      ])
    );
  }
  return value;
}

export function safeBody(value) {
  if (value === null || typeof value !== 'object') return null;
  const cleaned = redact(value);
  return JSON.stringify(cleaned).length > MAX_JSON_LENGTH
    ? { truncated: true }
    : cleaned;
}

export function entityIdFromPath(path) {
  const last = path.split('/').pop();
  return isUuid(last) ? last : null;
}
