// Audit rows preserve request/response and row snapshots. Restricted custom
// student fields remain restricted when those historical JSON objects are read:
// any property named `extra` is a field-id map and is filtered recursively.
export function redactRestrictedFields(value, restrictedIds) {
  const restricted =
    restrictedIds instanceof Set ? restrictedIds : new Set(restrictedIds ?? []);

  function visit(inner, key = null) {
    if (Array.isArray(inner)) return inner.map((item) => visit(item));
    if (inner === null || typeof inner !== 'object') return inner;

    const entries = Object.entries(inner);
    if (key === 'extra') {
      return Object.fromEntries(
        entries
          .filter(([fieldId]) => !restricted.has(fieldId))
          .map(([fieldId, fieldValue]) => [fieldId, visit(fieldValue)])
      );
    }
    return Object.fromEntries(
      entries.map(([childKey, childValue]) => [childKey, visit(childValue, childKey)])
    );
  }

  return visit(value);
}
