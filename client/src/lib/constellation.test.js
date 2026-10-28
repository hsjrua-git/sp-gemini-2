import { describe, it, expect } from 'vitest';
import {
  spherePoints,
  nodeAppearance,
  satelliteAppearance,
  satelliteRing,
} from './constellation.js';

const isUnit = (p) =>
  Math.abs(Math.hypot(p.x, p.y, p.z) - 1) < 1e-9;

describe('spherePoints', () => {
  it('returns nothing for a non-positive count', () => {
    expect(spherePoints(0)).toEqual([]);
    expect(spherePoints(-3)).toEqual([]);
  });

  it('returns exactly `count` points, all on the unit sphere', () => {
    const points = spherePoints(100);
    expect(points).toHaveLength(100);
    expect(points.every(isUnit)).toBe(true);
  });

  it('handles a single node without dividing by zero', () => {
    const [only] = spherePoints(1);
    expect(isUnit(only)).toBe(true);
  });

  it('spreads points rather than stacking them', () => {
    const points = spherePoints(20);
    const ys = new Set(points.map((p) => Math.round(p.y * 1000)));
    expect(ys.size).toBeGreaterThan(1);
  });
});

describe('nodeAppearance', () => {
  it('full students glow steadily on the ok hue', () => {
    expect(nodeAppearance({ state: 'full', measured: 5, inUse: 5 })).toEqual({
      colorVar: '--ok',
      glow: 1,
      hollow: false,
    });
  });

  it('partial glow scales with closeness to full', () => {
    const near = nodeAppearance({ state: 'partial', measured: 4, inUse: 5 });
    const far = nodeAppearance({ state: 'partial', measured: 1, inUse: 5 });
    expect(near.colorVar).toBe('--brand-2');
    expect(near.glow).toBeGreaterThan(far.glow);
    expect(near.glow).toBeCloseTo(0.8);
  });

  it('keeps a barely-started partial student visible (glow floor)', () => {
    const { glow } = nodeAppearance({ state: 'partial', measured: 1, inUse: 100 });
    expect(glow).toBeGreaterThanOrEqual(0.15);
  });

  it('not-yet students are hollow and dark', () => {
    expect(nodeAppearance({ state: 'none' })).toEqual({
      colorVar: '--ink-faint',
      glow: 0,
      hollow: true,
    });
  });
});

describe('satelliteAppearance', () => {
  it('coverage is the measured share of the class', () => {
    expect(satelliteAppearance({ count: 3, total: 4 })).toEqual({
      coverage: 0.75,
      glow: 0.75,
    });
  });

  it('is zero (not NaN) when the class is empty', () => {
    expect(satelliteAppearance({ count: 0, total: 0 })).toEqual({
      coverage: 0,
      glow: 0,
    });
  });
});

describe('satelliteRing', () => {
  it('returns one unit position per satellite', () => {
    const ring = satelliteRing(4);
    expect(ring).toHaveLength(4);
    expect(ring.every((p) => Math.abs(Math.hypot(p.x, p.z) - 1) < 1e-9)).toBe(true);
    expect(ring.every((p) => p.y === 0)).toBe(true);
  });

  it('places the first satellite at the front of the ring', () => {
    const [first] = satelliteRing(3);
    expect(first.z).toBeCloseTo(1); // +z faces the camera
    expect(first.x).toBeCloseTo(0);
  });

  it('is empty for no satellites', () => {
    expect(satelliteRing(0)).toEqual([]);
  });
});
