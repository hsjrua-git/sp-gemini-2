import { describe, it, expect } from 'vitest';
import {
  defaultExportConfig,
  normalizeExportConfig,
  mergePrefill,
  exportConfigErrors,
  includesTabular,
} from './exportConfig.js';

describe('normalizeExportConfig', () => {
  it('defaults to a runnable data export', () => {
    const config = normalizeExportConfig(null);
    expect(config).toEqual(defaultExportConfig());
    expect(config.include.data).toBe(true);
    expect(config.dimension).toBe('quality');
    expect(exportConfigErrors(config)).toEqual([]);
  });

  it('falls back to "all" when a selection is empty or a group is missing', () => {
    const config = normalizeExportConfig({
      students: { mode: 'selection', ids: [] },
      parameters: { mode: 'selection', ids: [] },
      scope: { assignmentId: null, mode: 'selection', seqs: [1, 2] }, // no assignment
    });
    expect(config.students.mode).toBe('all');
    expect(config.parameters.mode).toBe('all');
    expect(config.scope.mode).toBe('all');

    expect(normalizeExportConfig({ students: { mode: 'group', groupId: '' } }).students.mode).toBe(
      'all'
    );
  });

  it('the seq selection needs an assignment; a pinned one keeps valid seqs', () => {
    const pinned = normalizeExportConfig({
      scope: {
        assignmentId: '00000000-0000-4000-8000-000000000001',
        mode: 'selection',
        seqs: [3, 1, 2, 1],
      },
    });
    expect(pinned.scope).toEqual({
      assignmentId: '00000000-0000-4000-8000-000000000001',
      mode: 'selection',
      from: null,
      to: null,
      seqs: [1, 2, 3],
    });
    // An empty seq list falls back to the whole calendar.
    expect(
      normalizeExportConfig({
        scope: {
          assignmentId: '00000000-0000-4000-8000-000000000001',
          mode: 'selection',
          seqs: [],
        },
      }).scope.mode
    ).toBe('all');
  });

  it('orders a reversed date range and drops an incomplete one', () => {
    expect(
      normalizeExportConfig({ scope: { mode: 'range', from: '2024-03-01', to: '2024-01-01' } }).scope
    ).toEqual({
      assignmentId: null,
      mode: 'range',
      from: '2024-01-01',
      to: '2024-03-01',
      seqs: [],
    });
    expect(
      normalizeExportConfig({ scope: { mode: 'range', from: '2024-03-01', to: null } }).scope.mode
    ).toBe('all');
    // A non-date string is dropped too.
    expect(
      normalizeExportConfig({ scope: { mode: 'range', from: 'nonsense', to: '2024-01-01' } }).scope
        .mode
    ).toBe('all');
  });

  it('cleans charts, dropping unknown kinds and defaulting options', () => {
    const config = normalizeExportConfig({
      charts: [
        { kind: 'nope' },
        { kind: 'comparison', parameterIds: ['a', 'a', 2], comparisonShape: 'pie' },
        { kind: 'heatmap', imageFormat: 'gif', periodKey: 'assignment:4' },
      ],
    });
    expect(config.charts).toEqual([
      {
        kind: 'comparison',
        parameterIds: ['a'],
        periodKey: null,
        comparisonShape: 'bar',
        heatmapAxis: 'period',
        imageFormat: 'png',
      },
      {
        kind: 'heatmap',
        parameterIds: [],
        periodKey: 'assignment:4',
        comparisonShape: 'bar',
        heatmapAxis: 'period',
        imageFormat: 'png',
      },
    ]);
  });

  it('drops malformed filters but keeps valid ones', () => {
    const config = normalizeExportConfig({
      filters: [
        { parameterId: 'speed', op: 'gte', value: 5 },
        { parameterId: 'speed', op: 'gte' }, // needs a value
        { parameterId: 'x', op: 'present' },
        { op: 'lt', value: 1 }, // no parameterId
      ],
    });
    expect(config.filters).toEqual([
      { parameterId: 'speed', op: 'gte', value: 5 },
      { parameterId: 'x', op: 'present' },
    ]);
  });
});

describe('mergePrefill', () => {
  it('overlays a partial onto the defaults, merging nested scope', () => {
    const config = mergePrefill({
      students: { mode: 'group', groupId: 'g1' },
      parameters: { mode: 'selection', ids: ['p1', 'p2'] },
      include: { delta: true },
    });
    expect(config.students).toEqual({ mode: 'group', groupId: 'g1', ids: [] });
    expect(config.parameters).toEqual({ mode: 'selection', ids: ['p1', 'p2'] });
    expect(config.include.data).toBe(true); // untouched default preserved
    expect(config.include.delta).toBe(true);
  });

  it('maps a legacy periods prefill onto the seq selection', () => {
    const config = mergePrefill({
      periods: { mode: 'selection', numbers: [2, 1] },
      students: { mode: 'selection', ids: ['s1'] },
    });
    expect(config.scope.mode).toBe('all'); // no assignment pinned → cannot select seqs
    expect(config.scope.seqs).toEqual([1, 2]);
  });
});

describe('exportConfigErrors', () => {
  it('requires at least one artifact', () => {
    const empty = normalizeExportConfig({
      include: { data: false, delta: false, auditTrail: false },
      charts: [],
    });
    expect(includesTabular(empty)).toBe(false);
    expect(exportConfigErrors(empty)).toHaveLength(1);
  });

  it('flags a trend chart with no parameters', () => {
    const config = normalizeExportConfig({
      include: { data: false },
      charts: [{ kind: 'trend', parameterIds: [] }],
    });
    expect(exportConfigErrors(config).length).toBeGreaterThan(0);
  });
});
