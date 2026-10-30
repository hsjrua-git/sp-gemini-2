// Bundle several export artifacts into a single .zip download. fflate is loaded
// lazily so it lands in its own chunk. Each file is { name, data, compressed? }
// where data is a string (CSV/JSON/SVG), a Blob (XLSX/PNG), a Uint8Array, or an
// ArrayBuffer. `compressed: true` stores the bytes without deflating them, which
// is what you want for already-compressed content like PNG.
export async function buildZipBlob(files) {
  const { zipSync, strToU8 } = await import('fflate');

  const archive = {};
  for (const file of files) {
    let bytes;
    if (typeof file.data === 'string') bytes = strToU8(file.data);
    else if (file.data instanceof Uint8Array) bytes = file.data;
    else if (file.data instanceof ArrayBuffer) bytes = new Uint8Array(file.data);
    else if (typeof Blob !== 'undefined' && file.data instanceof Blob) {
      bytes = new Uint8Array(await file.data.arrayBuffer());
    } else {
      throw new Error(`Cannot bundle "${file.name}": unsupported data type`);
    }
    archive[file.name] = file.compressed ? [bytes, { level: 0 }] : bytes;
  }

  const zipped = zipSync(archive, { level: 6 });
  return new Blob([zipped], { type: 'application/zip' });
}
