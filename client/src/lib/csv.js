const FORMULA_START = /^[=+\-@\t\r]/;

// Neutralise spreadsheet formula-injection: a text cell that starts with one of
// these characters is prefixed with an apostrophe so Excel/Sheets treat it as
// literal text, not a formula. Shared by the CSV and XLSX writers.
export function guardFormula(text) {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

export function csvField(value, delimiter = ',') {
  if (value === null || value === undefined) return '';

  let text;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    text = String(value);
  } else {
    text = guardFormula(String(value));
  }

  if (text.includes(delimiter) || /["\r\n]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows, { delimiter = ',' } = {}) {
  const lines = rows.map((row) =>
    row.map((value) => csvField(value, delimiter)).join(delimiter)
  );
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}