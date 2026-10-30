export const SCORE_DIMENSIONS = ['quality', 'quantity'];

export function dimensionRange(parameter, dimension = 'quality') {
  return dimension === 'quality'
    ? { minValue: 0, maxValue: 100 }
    : { minValue: parameter.minValue ?? null, maxValue: parameter.maxValue ?? null };
}
