// Stable, cycle-safe tree ordering. Missing/archived parents remain visible as
// roots, and full paths disambiguate equally named children in pickers/exports.
export function hierarchy(items) {
  const byId = new Map(items.map(item => [item.id, item]));
  const children = new Map();
  for (const item of items) {
    const parent = byId.has(item.parentId) ? item.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(item);
  }
  const sort = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
    String(a.name ?? a.title ?? a.code).localeCompare(String(b.name ?? b.title ?? b.code));
  for (const list of children.values()) list.sort(sort);
  const seen = new Set();
  const result = [];
  function visit(item, ancestors) {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    const label = item.name ?? item.title ?? item.code ?? '';
    const path = [...ancestors.map(parent => parent.label), label].join(' / ');
    result.push({ ...item, label, path, depth: ancestors.length,
      ancestorIds: ancestors.map(parent => parent.id), hasChildren: (children.get(item.id)?.length ?? 0) > 0 });
    for (const child of children.get(item.id) ?? []) visit(child, [...ancestors, { id: item.id, label }]);
  }
  for (const item of children.get(null) ?? []) visit(item, []);
  for (const item of [...items].sort(sort)) visit(item, []);
  return result;
}

export function branchIds(items, roots) {
  const selected = new Set(roots);
  return hierarchy(items).filter(item => selected.has(item.id) || item.ancestorIds.some(id => selected.has(id))).map(item => item.id);
}

export function hierarchyLabel(item) {
  return `${'\u00a0\u00a0'.repeat(item.depth ?? 0)}${item.depth ? '↳ ' : ''}${item.label ?? item.name}`;
}

export function assignmentTree(assignments, groups) {
  const nodes = groups.map(group => ({ ...group, id: `group:${group.id}`, parentId: group.parentId ? `group:${group.parentId}` : null, selectable: false }));
  return [...nodes, ...assignments.map(assignment => ({ ...assignment,
    name: `${assignment.name ? `${assignment.name} · ` : ''}${assignment.code}${assignment.studentName ? ` · ${assignment.studentName}` : ''}`,
    parentId: assignment.groupId || assignment.studentGroupId ? `group:${assignment.groupId || assignment.studentGroupId}` : null,
  }))];
}
