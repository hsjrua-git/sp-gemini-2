import { mergePrefill } from './exportConfig.js';

// Resolve older links after the period catalogue loads. A missing explicit
// sequence must never silently expand into every period.
export function exportReportScope(prefill, current, periods) {
  const config = mergePrefill(prefill);
  const scope = { ...current };
  if (config.students.mode === 'group') {
    Object.assign(scope, { groupIds: [config.students.groupId], assignmentIds: [], periodIds: [] });
  }
  if (config.scope.assignmentId) {
    Object.assign(scope, { groupIds: [], assignmentIds: [config.scope.assignmentId], periodIds: [] });
    if (config.scope.mode === 'selection') {
      const selected = periods.filter(p => p.assignmentId === config.scope.assignmentId && config.scope.seqs.includes(p.seq));
      if (selected.length !== config.scope.seqs.length) return null;
      scope.periodIds = selected.map(p => p.id);
    }
  }
  if (prefill?.dimension) scope.dimensions = [config.dimension];
  return scope;
}

export function savedReportScope(config, periods) {
  if (config.reportScope) return config.reportScope;
  const available = periods.filter(p => p.assignmentId === config.assignmentId && p.sessionCount > 0);
  const seq = config.seq ?? Math.max(0, ...available.map(p => p.seq));
  const selected = available.filter(p => p.seq === seq);
  if (!selected.length) return null;
  return { groupIds: [], assignmentIds: [config.assignmentId], periodIds: selected.map(p => p.id), dimensions: [config.dimension ?? 'quality'] };
}
