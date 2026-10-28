import { guardFormula } from './csv.js';

// One cell of a write-excel-file row. Numbers/booleans keep their native type so
// Excel treats them as data, not text; strings are formula-guarded like the CSV
// writer; blanks become an empty cell. `header` bolds the top row.
export function toCell(value, header = false) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return { value, type: Number };
  }
  if (typeof value === 'boolean') return { value, type: Boolean };
  const cell = { value: guardFormula(String(value)), type: String };
  if (header) cell.fontWeight = 'bold';
  return cell;
}

export function toSheetData(rows) {
  return rows.map((row, index) => row.map((value) => toCell(value, index === 0)));
}

// Build a multi-sheet .xlsx workbook as a Blob. `sheets` is [{ name, rows }],
// where rows is the 2-D array a row-builder from exports.js produced. The
// write-excel-file library is loaded lazily so it lands in its own chunk.
export async function buildWorkbookBlob(sheets) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const payload = sheets.map((sheet, index) => ({
    data: toSheetData(sheet.rows),
    sheet: sheet.name || `Sheet ${index + 1}`,
  }));
  const { toBlob } = await writeXlsxFile(payload);
  return toBlob();
}
