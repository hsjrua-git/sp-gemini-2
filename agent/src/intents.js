// The deterministic bilingual brain: maps an utterance onto an intent
// without any model. It is the fallback (and the test seam) when no LLM is
// configured, and the SAFETY net for the confirmation protocol's yes/no —
// those two words are matched literally here even when an LLM is driving,
// because money must never hinge on model inference.

import { normalizeForMatch } from './cartMath.js';

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function toLatinDigits(text) {
  return String(text)
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

const FA_QTY_WORDS = {
  'یک': 1, 'یه': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'چهارتا': 4, 'پنج': 5,
  'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10,
  'نیم': 0.5,
};
const EN_QTY_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1, half: 0.5,
};

// Confirmation phrases: matched against the utterance after stripping
// punctuation and politeness words, so «ثبت بشه؟» and "yes, go ahead"
// both land. Anything longer or subtler is NOT a yes — the operator can
// always use the screen button.
const FA_BOUNDARY_START = '(?:^|[\\s،,.!؟?])';
const FA_BOUNDARY_END = '(?=$|[\\s،,.!؟?])';
const FA_POLITE = new RegExp(
  `${FA_BOUNDARY_START}(لطفا|لطفاً|میشه|می‌شه)${FA_BOUNDARY_END}`,
  'g'
);
const EN_POLITE = /\b(please|could you|would you)\b/gi;

const YES_FA = new Set(['بله', 'اره', 'آره', 'ثبت بشه', 'ثبت کن', 'تایید', 'تأیید', 'تایید میکنم', 'تأیید می‌کنم', 'همینه', 'همينه', 'اوکی', 'باشه', 'حتما', 'بله ثبت بشه', 'بله ثبت کن']);
const YES_EN = new Set(['yes', 'yep', 'yeah', 'confirm', 'confirmed', "that's right", 'thats right', 'go ahead', 'record it', 'sure', 'do it', 'yes go ahead', 'yes record it', 'yes confirm', 'yes do it']);
const NO_FA = new Set(['نه', 'نخیر', 'لغو', 'بیخیال', 'بی خیال', 'منصرف شدم', 'اشتباهه', 'نه ثبت نشه', 'نه لغو']);
const NO_EN = new Set(['no', 'nope', 'cancel', 'nevermind', 'never mind', 'forget it', 'wrong', 'no cancel', 'no nevermind']);

function normalizedConfirmation(text) {
  return toLatinDigits(text)
    .replace(/[.،,!?؟!]+/g, ' ')
    .replace(FA_POLITE, ' ')
    .replace(EN_POLITE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const MENU_FA = /(منو|چی داری|چی دارید|چه چیزی داری|قیمت|چی داریم)/;
const MENU_EN = /\b(menu|what do you (have|serve)|prices?|what.s on the menu)\b/i;
const BALANCE_FA = /(مانده|حسابش? چقدره|چقدر (پول )?داره|اعتبار)/;
const BALANCE_EN = /\b(balance|how much does .+ have|credit)\b/i;
const REPORT_FA = /(گزارش|امروز چقدر فروختیم|فروش امروز)/;
const REPORT_EN = /\b(report|sales today|how did today go)\b/i;
const VOID_FA = /(برگردون|ابطال|پشیمون(م| شدم)|حذفش کن)/;
const VOID_EN = /\b(undo|void( it)?|take it back|i changed my mind)\b/i;
const CANCEL_FA = /(لغو|بی ?خیال|منصرف)/;
const CANCEL_EN = /\b(cancel|nevermind|never mind|forget it)\b/i;
const ATTACH_FA = /به حساب (?!خودم)(.+)/;
const ATTACH_EN = /\b(?:charge (?:it )?to|for) (?:student )?(.+)/i;

export function parseQuantity(text) {
  const normalized = toLatinDigits(text).trim();
  // digits (possibly decimal)
  const digit = normalized.match(/(?:^|\s)(\d+(?:\.\d{1,3})?)\s*(?:تا|x|×)?\s*$/i);
  if (digit) return Number(digit[1]);
  // «دو و نیم» / "two and a half"
  const andHalf = normalized.match(/(\S+)\s*(?:و نیم|and (?:a )?half)/i);
  if (andHalf) {
    const base = FA_QTY_WORDS[andHalf[1]] ?? EN_QTY_WORDS[andHalf[1].toLowerCase()];
    if (base) return base + 0.5;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  for (const word of words) {
    const value = FA_QTY_WORDS[word] ?? EN_QTY_WORDS[word.toLowerCase()];
    if (value) return value;
  }
  return null;
}

const FA_QTY_REGEX = new RegExp(
  `${FA_BOUNDARY_START}(${Object.keys(FA_QTY_WORDS).join('|')})${FA_BOUNDARY_END}`,
  'g'
);

function stripQty(text) {
  return toLatinDigits(text)
    .replace(/(?:^|[\s،,.!؟?])\d+(?:\.\d{1,3})?\s*(?:تا|x|×|pcs?|pieces?)(?=$|[\s،,.!؟?])/gi, ' ')
    .replace(FA_QTY_REGEX, ' ')
    .replace(new RegExp(`\\b(${Object.keys(EN_QTY_WORDS).join('|')})\\b`, 'gi'), ' ')
    .replace(/(?:^|[\s،,.!؟?])(?:and (?:a )?half|و نیم)(?=$|[\s،,.!؟?])/gi, ' ')
    .replace(/(?:^|[\s،,.!؟?])(?:تا|pcs?|pieces? of|of)(?=$|[\s،,.!؟?])/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Best product match: the longest product name contained in the utterance.
export function matchProduct(text, products) {
  const haystack = normalizeForMatch(text);
  let best = null;
  for (const product of products) {
    const needle = normalizeForMatch(product.name);
    if (needle.length >= 2 && haystack.includes(needle)) {
      if (!best || needle.length > normalizeForMatch(best.name).length) best = product;
    }
  }
  return best;
}

function extractName(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/[؟?.!]/g, '').trim();
  }
  return null;
}

// Parse one utterance into { intent, params } — `null` when nothing matches.
// `state` needs `products` (for add/remove matching); language is detected
// from the script, with the session language as the tiebreak.
export function parseUtterance(rawText, state) {
  const text = normalizeForMatch(rawText);
  const lang = /[\u0600-\u06FF]/.test(rawText) ? 'fa' : 'en';

  if (/^(english|انگلیسی|فارسی|persian)$/.test(text)) {
    return { intent: 'switch_language', params: { lang: rawText.match(/english|انگلیسی/i) ? 'en' : 'fa' } };
  }

  // Confirmation yes/no — matched LITERALLY, before anything else, whenever
  // the dialogue is waiting for one. A cancel phrase while confirming is a
  // rejection of the sale (same effect as confirm_no).
  if (state.phase === 'confirming') {
    const confirmation = normalizedConfirmation(rawText);
    if (YES_FA.has(confirmation) || YES_EN.has(confirmation)) {
      return { intent: 'confirm_yes', params: { lang } };
    }
    if (NO_FA.has(confirmation) || NO_EN.has(confirmation)) {
      return { intent: 'confirm_no', params: { lang } };
    }
    if (CANCEL_FA.test(text) || CANCEL_EN.test(text)) {
      return { intent: 'confirm_no', params: { lang } };
    }
  }

  if (MENU_FA.test(text) || MENU_EN.test(text)) return { intent: 'menu', params: { lang } };
  if (REPORT_FA.test(text) || REPORT_EN.test(text)) return { intent: 'report', params: { lang } };
  if (VOID_FA.test(text) || VOID_EN.test(text)) return { intent: 'void', params: { lang } };

  const name = (patterns) => extractName(rawText, patterns);
  if (BALANCE_FA.test(text) || BALANCE_EN.test(text)) {
    // The name patterns are ordered most-specific first, and the captured
    // name is cleaned of the question tail («چقدره», "have") either way.
    const who = (
      name([/(?:مانده|اعتبار)\s*(?:دانش ?آموز)?\s*(.+)/, /(.+?)\s*(?:چقدر|چند)\s*(?:پول )?داره/]) ??
      name([/\bhow much does (.+?) have\b/i, /\bbalance (?:of|for) (.+)/i])
    )?.replace(/(چقدره|چنده|چقدر داره|دارید|دارد)$/g, '').trim();
    return { intent: 'balance', params: { lang, search: who ?? '' } };
  }
  if (CANCEL_FA.test(text) || CANCEL_EN.test(text)) return { intent: 'cancel', params: { lang } };

  const attachFa = text.match(ATTACH_FA);
  const attachEn = rawText.match(ATTACH_EN);
  if (attachFa || attachEn) {
    const who = (attachFa?.[1] ?? attachEn?.[1] ?? '').trim();
    if (who) return { intent: 'attach', params: { lang, search: who } };
  }

  if (YES_FA.has(normalizedConfirmation(rawText)) || YES_EN.has(normalizedConfirmation(rawText))) {
    return { intent: 'confirm_yes', params: { lang } };
  }
  if (NO_FA.has(normalizedConfirmation(rawText)) || NO_EN.has(normalizedConfirmation(rawText))) {
    return { intent: 'confirm_no', params: { lang } };
  }

  // Add/remove: matched by product name anywhere in the utterance.
  const product = matchProduct(rawText, state.products ?? []);
  if (product) {
    const removing = /(بردار|حذف|کنسل)/.test(text) || /\b(remove|take off|without)\b/i.test(text);
    const qty = parseQuantity(stripQty(rawText).replace(normalizeKeep(rawText, product.name), '')) ??
      parseQuantity(rawText) ?? 1;
    return {
      intent: removing ? 'remove' : 'add',
      params: { lang, product, qty },
    };
  }

  return null;
}

// Find the original-script occurrence of the product name so the qty parser
// doesn't eat its letters (e.g. a product named «ده» would break quantities).
function normalizeKeep(rawText, productName) {
  const idx = normalizeForMatch(rawText).indexOf(normalizeForMatch(productName));
  if (idx < 0) return '';
  return rawText.slice(idx, idx + productName.length);
}
