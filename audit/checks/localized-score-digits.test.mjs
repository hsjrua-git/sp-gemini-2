import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSaveEntries, parseDimension, pruneDraft } from '../../client/src/lib/cells.js';

const parameter = { id: 'parameter', minValue: -20, maxValue: 100 };

test('ASCII whole scores, blank and zero retain their established meaning', () => {
  for (const [text, value] of [['7', 7], ['+6', 6], ['-12', -12], ['0', 0], ['  ', null]]) {
    assert.deepEqual(parseDimension(text, parameter), { value });
  }
});

test('Persian score digits denote the same whole numbers', () => {
  for (const [text, value] of [['۷', 7], ['+۶', 6], ['-۱۲', -12], ['۰', 0], [' ۱۰۰ ', 100]]) {
    assert.deepEqual(parseDimension(text, parameter), { value }, text);
  }
});

test('Arabic-Indic keyboard digits denote the same whole numbers', () => {
  for (const [text, value] of [['٧', 7], ['+٦', 6], ['-١٢', -12], ['٠', 0], [' ١٠٠ ', 100]]) {
    assert.deepEqual(parseDimension(text, parameter), { value }, text);
  }
});

test('localized drafts create numeric save entries and preserve saved comments', () => {
  const key = 'group:parameter';
  const saved = { qualityValue: 1, quantityValue: 2, qualityComment: 'existing quality note', quantityComment: null };
  const result = buildSaveEntries({
    drafts: { [key]: { selected: true, qualityText: '۷', quantityText: '٦' } },
    savedByCell: new Map([[key, saved]]), parametersById: new Map([['parameter', parameter]]),
  });
  assert.deepEqual(result, { errors: {}, entries: [{ membershipId: null, parameterId: 'parameter',
    selected: true, qualityValue: 7, quantityValue: 6, qualityComment: 'existing quality note', quantityComment: null }] });
});

test('typing the same saved score in localized digits is a no-op', () => {
  assert.equal(pruneDraft({ qualityText: '۷', quantityText: '٦' },
    { qualityValue: 7, quantityValue: 6, qualityComment: null, quantityComment: null }, parameter), null);
});

test('digit normalization must retain strict syntax and range checks', () => {
  for (const text of ['7.5', '۷.۵', '۷٫۵', '١e٢', '1e2', '0x10', '۷x', '۷ ۶', '--7', '101', '۱۰۱', '-۲۱']) {
    assert.ok(parseDimension(text, parameter).error, `reject ${text}`);
  }
});
