import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPersianWords, tomanWords } from '../src/faWords.js';

test('basic numbers compose with و', () => {
  assert.equal(toPersianWords(0), 'صفر');
  assert.equal(toPersianWords(7), 'هفت');
  assert.equal(toPersianWords(25), 'بیست و پنج');
  assert.equal(toPersianWords(105), 'یکصد و پنج');
  assert.equal(toPersianWords(350), 'سیصد و پنجاه');
});

test('thousands, millions and billions use their scale names', () => {
  assert.equal(toPersianWords(1000), 'یک هزار');
  assert.equal(toPersianWords(250_000), 'دویست و پنجاه هزار');
  assert.equal(toPersianWords(2_500_000), 'دو میلیون و پانصد هزار');
  assert.equal(toPersianWords(1_234_567), 'یک میلیون و دویست و سی و چهار هزار و پانصد و شصت و هفت');
  assert.equal(toPersianWords(1_000_000_000), 'یک میلیارد');
});

test('the whole money range the server allows is representable', () => {
  assert.match(tomanWords(999_999_999_999), /میلیارد/);
  assert.equal(tomanWords(-1), null);
  assert.equal(tomanWords(1.5), null);
});
