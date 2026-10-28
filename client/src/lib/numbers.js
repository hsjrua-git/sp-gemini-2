export function parseOptionalNumber(text) {
  const trimmed = text.trim();
  if (trimmed === '') return { value: null };
  const number = Number(trimmed);
  return Number.isFinite(number) ? { value: number } : { error: true };
}

export function numberToText(value) {
  return value === null ? '' : String(value);
}