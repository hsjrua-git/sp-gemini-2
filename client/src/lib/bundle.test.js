// @vitest-environment node
// fflate produces a real Blob; jsdom's Blob lacks arrayBuffer(), so read it back
// under Node's environment (Node ≥18 Blob supports arrayBuffer).
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildZipBlob } from './bundle.js';

async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('buildZipBlob', () => {
  it('zips text and binary artifacts into one archive', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const blob = await buildZipBlob([
      { name: 'data.csv', data: 'Period,Value\r\n2,6\r\n' },
      { name: 'scope.json', data: '{"note":"x"}' },
      { name: 'chart.png', data: png, compressed: true },
    ]);
    expect(blob.type).toBe('application/zip');

    const files = unzipSync(await bytesOf(blob));
    expect(Object.keys(files).sort()).toEqual(['chart.png', 'data.csv', 'scope.json']);
    expect(strFromU8(files['data.csv'])).toBe('Period,Value\r\n2,6\r\n');
    expect(strFromU8(files['scope.json'])).toBe('{"note":"x"}');
    expect(Array.from(files['chart.png'])).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('accepts a Blob as file data', async () => {
    const source = new Blob(['hello'], { type: 'text/plain' });
    const blob = await buildZipBlob([{ name: 'note.txt', data: source }]);
    const files = unzipSync(await bytesOf(blob));
    expect(strFromU8(files['note.txt'])).toBe('hello');
  });

  it('rejects an unsupported data type', async () => {
    await expect(buildZipBlob([{ name: 'bad', data: 123 }])).rejects.toThrow(/unsupported data type/);
  });
});
