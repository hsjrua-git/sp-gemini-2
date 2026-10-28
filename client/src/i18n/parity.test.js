import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Every locale file must exist in both languages with exactly the same key
// tree, so a key translated in one language can never be missing (and render
// its raw key) in the other. The server sends error codes; the client
// catalogue must always be able to answer in both fa and en.
const directory = path.dirname(fileURLToPath(import.meta.url));

function flatten(prefix, value, into) {
  for (const [key, inner] of Object.entries(value)) {
    const at = prefix === '' ? key : `${prefix}.${key}`;
    if (inner !== null && typeof inner === 'object') flatten(at, inner, into);
    else into.push(at);
  }
}

function keysFor(locale, file) {
  const parsed = JSON.parse(
    readFileSync(path.join(directory, locale, file), 'utf8')
  );
  const keys = [];
  flatten('', parsed, keys);
  return keys.sort();
}

function namespaceFiles() {
  return readdirSync(path.join(directory, 'fa')).filter((name) =>
    name.endsWith('.json')
  );
}

describe('locale key parity', () => {
  it('every namespace has identical key trees in fa and en', () => {
    const files = namespaceFiles();
    expect(files.length, 'at least common/nav/errors exist').toBeGreaterThan(
      0
    );
    for (const file of files) {
      const fa = keysFor('fa', file);
      const en = keysFor('en', file);
      expect(
        en,
        `${file}: keys present in fa but missing in en`
      ).toEqual(fa);
    }
  });

  it('the base namespaces all exist', () => {
    expect(namespaceFiles()).toEqual(
      expect.arrayContaining(['common.json', 'nav.json', 'errors.json'])
    );
  });

  it('every literal server error code has a localized catalogue entry', () => {
    const server = path.resolve(directory, '../../../server/src');
    const files = [];
    function walk(at) {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const file = path.join(at, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(file);
      }
    }
    walk(server);
    const emitted = new Set();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of [
        /\bcode\s*:\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
        /\berror\s*:\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
      ]) {
        for (const match of source.matchAll(pattern)) emitted.add(match[1]);
      }
    }
    const errors = new Set(keysFor('en', 'errors.json').filter((key) => !key.startsWith('entities.')));
    expect([...emitted].filter((code) => !errors.has(code)).sort()).toEqual([]);
  });
});
