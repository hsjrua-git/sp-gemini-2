// Compare a decimal round-trip, not qty * 1000: binary multiplication can
// put valid thousandths just below an integer (for example 1.005).
export function hasQuantityPrecision(value) {
  return Number.isFinite(value) && Number(value.toFixed(3)) === value;
}
