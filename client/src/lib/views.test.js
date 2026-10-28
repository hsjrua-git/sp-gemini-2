import { describe, expect, it } from 'vitest';
import { periodView } from './views.js';

const parameter = {
  id: 'focus',
  name: 'Focus',
  minValue: 0,
  maxValue: 10,
};

describe('periodView persisted membership', () => {
  it('uses periodSeq, not overlapping dates, and computes the prior-period delta', () => {
    const evaluations = [
      {
        assignmentId: 'a1',
        sessionId: 's1',
        sessionDate: '2026-03-10',
        periodSeq: 1,
        parameterId: parameter.id,
        membershipId: null,
        qualityValue: 4,
        quantityValue: null,
      },
      {
        assignmentId: 'a1',
        sessionId: 's2',
        // The same effective date can legitimately belong to another period.
        sessionDate: '2026-03-10',
        periodSeq: 2,
        parameterId: parameter.id,
        membershipId: 'm1',
        qualityValue: 9,
        quantityValue: null,
      },
      {
        assignmentId: 'a1',
        sessionId: 'detached',
        sessionDate: '2026-03-10',
        periodSeq: null,
        parameterId: parameter.id,
        membershipId: 'm1',
        qualityValue: 1,
        quantityValue: null,
      },
    ];

    const rows = periodView({
      evaluations,
      assignmentId: 'a1',
      seq: 2,
      parameters: [parameter],
      dimension: 'quality',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ value: 9, change: 5, viaGroup: false });
  });

  it('lets a member cell shadow the whole-group cell in the same session', () => {
    const rows = periodView({
      assignmentId: 'a1',
      seq: 1,
      parameters: [parameter],
      evaluations: [
        {
          assignmentId: 'a1',
          sessionId: 's1',
          sessionDate: '2026-03-10',
          periodSeq: 1,
          parameterId: parameter.id,
          membershipId: null,
          qualityValue: 8,
          quantityValue: null,
        },
        {
          assignmentId: 'a1',
          sessionId: 's1',
          sessionDate: '2026-03-10',
          periodSeq: 1,
          parameterId: parameter.id,
          membershipId: 'm1',
          qualityValue: 6,
          quantityValue: null,
        },
      ],
    });

    expect(rows[0]).toMatchObject({ value: 6, viaGroup: false });
  });
});
