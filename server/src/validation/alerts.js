// Alerts are machine-raised; the only client input is which slice to list and
// whether a single alert is resolved or reopened.

const STATUSES = new Set(['open', 'resolved', 'all']);

export function parseAlertStatus(value) {
  const status = value === undefined ? 'open' : value;
  if (!STATUSES.has(status)) {
    return {
      error: 'status must be open, resolved or all.',
      code: 'VALIDATION_INVALID_CHOICE',
    };
  }
  return { value: status };
}

export function parseAlertPatch(body) {
  if (typeof body?.resolved !== 'boolean') {
    return {
      error: 'resolved must be true or false.',
      code: 'VALIDATION_INVALID_TYPE',
    };
  }
  return { value: { resolved: body.resolved } };
}
