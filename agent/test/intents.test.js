import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUtterance, parseQuantity, matchProduct } from '../src/intents.js';

const PRODUCTS = [
  { id: 'p1', name: 'پیتزا', price: 120000 },
  { id: 'p2', name: 'قهوه', price: 25000 },
  { id: 'p3', name: 'چای', price: 10000 },
];
const idle = { phase: 'idle', products: PRODUCTS };
const confirming = { phase: 'confirming', products: PRODUCTS };

test('quantities: Persian digits, Latin digits, words, halves', () => {
  assert.equal(parseQuantity('۳'), 3);
  assert.equal(parseQuantity('2 تا'), 2);
  assert.equal(parseQuantity('دو و نیم'), 2.5);
  assert.equal(parseQuantity('نیم'), 0.5);
  assert.equal(parseQuantity('three'), 3);
  assert.equal(parseQuantity('two and a half'), 2.5);
  assert.equal(parseQuantity('1.5'), 1.5);
  assert.equal(parseQuantity('no numbers here'), null);
});

test('menu, report and language switch in both languages', () => {
  assert.equal(parseUtterance('منو چی داری؟', idle).intent, 'menu');
  assert.equal(parseUtterance('what do you have?', idle).intent, 'menu');
  assert.equal(parseUtterance('گزارش فروش امروز', idle).intent, 'report');
  assert.equal(parseUtterance('sales today', idle).intent, 'report');
  assert.deepEqual(parseUtterance('english', idle), {
    intent: 'switch_language',
    params: { lang: 'en' },
  });
  assert.deepEqual(parseUtterance('فارسی', { ...idle, lang: 'en' }), {
    intent: 'switch_language',
    params: { lang: 'fa' },
  });
});

test('confirmation yes/no are matched literally while confirming', () => {
  assert.equal(parseUtterance('ثبت بشه', confirming).intent, 'confirm_yes');
  assert.equal(parseUtterance('آره', confirming).intent, 'confirm_yes');
  assert.equal(parseUtterance('yes, go ahead', confirming).intent, 'confirm_yes');
  assert.equal(parseUtterance('نه منصرف شدم', confirming).intent, 'confirm_no');
  assert.equal(parseUtterance('nevermind', confirming).intent, 'confirm_no');
  // ...and NOT treated as the protocol answer when not confirming
  assert.equal(parseUtterance('بله', idle).intent, 'confirm_yes'); // handled as read-back
});

test('adding a product: Persian and English with quantities', () => {
  const two = parseUtterance('دو تا پیتزا', idle);
  assert.equal(two.intent, 'add');
  assert.equal(two.params.product.id, 'p1');
  assert.equal(two.params.qty, 2);

  const half = parseUtterance('نیم پیتزا', idle);
  assert.equal(half.params.qty, 0.5);

  // The rule brain matches by NAME containment — an English utterance needs
  // a Latin-named product (paraphrase like "pizzas" → «پیتزا» is the LLM
  // brain's job; see README).
  const latin = parseUtterance('two pizzas please', { ...idle, products: [...idle.products, { id: 'p4', name: 'Pizza', price: 150000 }] });
  assert.equal(latin.intent, 'add');
  assert.equal(latin.params.product.id, 'p4');
  assert.equal(latin.params.qty, 2);

  const bare = parseUtterance('یه قهوه', idle);
  assert.equal(bare.params.product.id, 'p2');
  assert.equal(bare.params.qty, 1);
});

test('balance and attach extract the student name', () => {
  const fa = parseUtterance('مانده علی چقدره؟', idle);
  assert.equal(fa.intent, 'balance');
  assert.equal(fa.params.search, 'علی چقدره'.replace(' چقدره', '') || fa.params.search);
  assert.ok(fa.params.search.includes('علی'));

  const en = parseUtterance('what is the balance of Sara?', idle);
  assert.equal(en.intent, 'balance');
  assert.ok(en.params.search.toLowerCase().includes('sara'));

  const charge = parseUtterance('به حساب علی ثبت کن', idle);
  assert.equal(charge.intent, 'attach');
  assert.ok(charge.params.search.includes('علی'));
});

test('product matching prefers the longest name', () => {
  const products = [{ id: 'a', name: 'چای' }, { id: 'b', name: 'چای تازه' }];
  assert.equal(matchProduct('یه چای تازه میخوام', products).id, 'b');
});

test('unrecognized utterances return null for the handover counter', () => {
  assert.equal(parseUtterance('هوا چطوره؟', idle), null);
});
