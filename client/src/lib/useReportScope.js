import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listGroups } from '../api/groups.js';
import { listAssignments } from '../api/schedule.js';
import { getPeriods } from '../api/periods.js';
import { getScopedResults } from '../api/results.js';
import { usePreferences } from '../preferences/PreferencesContext.jsx';
import { DEFAULT_PREFERENCES } from '../preferences/defaults.js';
import { assignmentTree, branchIds, hierarchy } from './hierarchy.js';

const EMPTY = [];
export function useReportScope({ enabled = true } = {}) {
  const { preferences, update } = usePreferences();
  const scope = preferences.reportScope ?? DEFAULT_PREFERENCES.reportScope;
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: listGroups, enabled });
  const assignmentsQuery = useQuery({ queryKey: ['assignments'], queryFn: listAssignments, enabled });
  const periodsQuery = useQuery({ queryKey: ['periods', 'all'], queryFn: () => getPeriods(), enabled });
  const groups = groupsQuery.data ?? EMPTY;
  const assignments = assignmentsQuery.data ?? EMPTY;
  const periods = periodsQuery.data ?? EMPTY;
  const derived = useMemo(() => {
    const groupIds = new Set(branchIds(groups, scope.groupIds));
    const availableAssignments = assignments.filter(a => !scope.groupIds.length || groupIds.has(a.groupId ?? a.studentGroupId));
    const chosenAssignments = availableAssignments.filter(a => !scope.assignmentIds.length || scope.assignmentIds.includes(a.id));
    const chosenIds = new Set(chosenAssignments.map(a => a.id));
    const availablePeriods = periods.filter(p => p.sessionCount > 0 && chosenIds.has(p.assignmentId));
    const selectedPeriods = availablePeriods.filter(p => !scope.periodIds.length || scope.periodIds.includes(p.id));
    return { availableAssignments, availablePeriods, selectedPeriods, assignmentNodes: assignmentTree(availableAssignments, groups) };
  }, [assignments, groups, periods, scope]);
  return { scope, groups, assignments, periods, ...derived,
    isPending: groupsQuery.isPending || assignmentsQuery.isPending || periodsQuery.isPending,
    error: groupsQuery.error || assignmentsQuery.error || periodsQuery.error || update.error,
    change: (changes, callbacks) => update.mutate({ reportScope: { ...scope, ...changes } }, callbacks),
  };
}

export function useReportResults(report) {
  const ids = report.selectedPeriods.map(period => period.id).sort();
  const query = useQuery({ queryKey: ['results', 'scope', ids], queryFn: () => getScopedResults(ids),
    enabled: !report.isPending && !report.error && ids.length > 0 && ids.length <= 200 });
  const data = useMemo(() => query.data ? { ...query.data, parameters: hierarchy(query.data.parameters) } : null, [query.data]);
  return { ...query, data, isPending: report.isPending || (ids.length > 0 && ids.length <= 200 && !report.error && query.isPending), tooMany: ids.length > 200 };
}
