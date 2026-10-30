// A DOM anchor click is the portable way to trigger a "Save as" for a blob we
// built in memory (a CSV string, a generated .xlsx, a chart image, a ZIP). The
// object URL is revoked shortly after the click so we don't leak it.
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadTextFile(filename, text, type = 'text/csv;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type }));
}
