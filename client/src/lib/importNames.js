const HEADER_CELL =
  /^(full[\s_-]*name|name|student(\s*name)?|first[\s_-]*name|given[\s_-]*name|last[\s_-]*name|surname|family[\s_-]*name)$/i;
const FULL_NAME = /^(full[\s_-]*name|name|student(\s*name)?)$/i;
const FIRST_NAME = /^(first[\s_-]*name|given[\s_-]*name)$/i;
const LAST_NAME = /^(last[\s_-]*name|surname|family[\s_-]*name)$/i;

export function prepareRows(parsedRows) {
  return parsedRows
    .map((cells, index) => ({ row: index + 1, cells }))
    .filter(({ cells }) =>
      cells.some((cell) => String(cell ?? '').trim() !== '')
    );
}

export function looksLikeHeader(cells) {
  return cells.some((cell) => HEADER_CELL.test(String(cell ?? '').trim()));
}

export function guessColumns(headerCells) {
  const texts = headerCells.map((cell) => String(cell ?? '').trim());

  const full = texts.findIndex((text) => FULL_NAME.test(text));
  if (full !== -1) {
    return { mode: 'single', firstColumn: full, secondColumn: null };
  }

  const first = texts.findIndex((text) => FIRST_NAME.test(text));
  const last = texts.findIndex((text) => LAST_NAME.test(text));
  if (first !== -1 && last !== -1) {
    return { mode: 'two', firstColumn: first, secondColumn: last };
  }
  return { mode: 'single', firstColumn: 0, secondColumn: null };
}

export function buildNames({ rows, hasHeader, mode, firstColumn, secondColumn }) {
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const pick = (cells, index) =>
    index === null || index === undefined
      ? ''
      : String(cells[index] ?? '').trim();

  return dataRows.map(({ row, cells }) => ({
    row,
    fullName:
      mode === 'two'
        ? `${pick(cells, firstColumn)} ${pick(cells, secondColumn)}`.trim()
        : pick(cells, firstColumn),
  }));
}