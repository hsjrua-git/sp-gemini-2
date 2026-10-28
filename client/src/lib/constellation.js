// Pure geometry + appearance math for the 3D cohort constellation. No three.js,
// no DOM — just the numbers the WebGL component (CohortConstellation.jsx) turns
// into meshes and sprites, kept here so they can be unit-tested in isolation and
// so the visual component stays thin.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈137.5°

// Even points on a unit sphere (Fibonacci / golden-spiral lattice). Each student
// becomes one node on this shell around the core, so a roster of any size spreads
// without clumping. Returns unit vectors {x,y,z}; the component scales them to the
// shell radius and parents them to the spinning core so they revolve with it.
export function spherePoints(count) {
  if (count <= 0) return [];
  const denom = Math.max(count - 1, 1);
  return Array.from({ length: count }, (_, i) => {
    const y = count === 1 ? 0 : 1 - (i / denom) * 2; // 1 → -1 down the axis
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE;
    return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
  });
}

// A student node's colour + glow. Colour is by state (kept from the 2D hero so
// the legend still reads); the partial glow scales with how close to fully
// measured the student is — the user's "glows depending on how close to full it
// is". Full nodes glow steadily; not-yet nodes are hollow and dark.
export function nodeAppearance({ state, measured = 0, inUse = 0 }) {
  if (state === 'full') return { colorVar: '--ok', glow: 1, hollow: false };
  if (state === 'partial') {
    const ratio = inUse > 0 ? measured / inUse : 0;
    // Clamp to a floor so a barely-started student still reads as "alive", not off.
    const glow = Math.min(1, Math.max(0.15, ratio));
    return { colorVar: '--brand-2', glow, hollow: false };
  }
  return { colorVar: '--ink-faint', glow: 0, hollow: true };
}

// A parameter satellite's fill. Coverage (share of the class carrying a score for
// it this period) is magnitude, so it drives glow on a single brand hue — never
// an identity colour. `coverage` is the 0–1 fraction the hollow ring fills to.
export function satelliteAppearance({ count = 0, total = 0 }) {
  const coverage = total > 0 ? count / total : 0;
  return { coverage, glow: coverage };
}

// Even angular placement for the satellite ring in the core's equatorial (XZ)
// plane, first satellite at the front (nearest the camera) so it isn't born
// hidden behind the core. Unit positions; the component scales by ring radius.
export function satelliteRing(count) {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.PI / 2 + (i / count) * Math.PI * 2; // start at front
    return { angle, x: Math.cos(angle), y: 0, z: Math.sin(angle) };
  });
}
