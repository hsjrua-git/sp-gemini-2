// Every sentence the agent can SAY or SHOW, in Persian and English. Nothing
// else in the agent hardcodes human-facing text — the dialogue composes its
// answers from these functions, in the language of the current turn (the
// utterance's script, with the session language as fallback). This is what
// makes the agent bilingual without duplicating logic.

import { tomanWords } from './faWords.js';

const fa = {
  greeting: () => 'سلام! کافه من هستم. منو بپرسید، مانده بگویید، یا سفارش بدهید.',
  menuList: (products) =>
    products.length
      ? `${products.map((p) => `${p.name} ${tomanWords(p.price)}`).join('، ')}.`
      : 'کافه فعلاً محصولی ندارد.',
  balance: (balance) => `مانده ${describeBalanceFa(balance)}.`,
  studentFound: (name, balance) => `${name} پیدا شد؛ مانده ${describeBalanceFa(balance)}.`,
  studentNotFound: () => 'دانش‌آموزی با این نام پیدا نشد.',
  studentAmbiguous: (n) => `${n} دانش‌آموز پیدا شد؛ بگویید کدام.`,
  added: (product) => `${product.name} اضافه شد.`,
  notInMenu: () => 'چنین محصولی در منو نیست.',
  removed: () => 'حذف شد.',
  notInCart: () => 'چنین قلمی در سبد نیست.',
  invalidQty: () => 'تعداد معتبر نیست.',
  emptyCart: () => 'سبد خالی است.',
  canceled: () => 'انصراف؛ سبد خالی شد.',
  balanceWho: () => 'مانده چه کسی؟ نام یا کد را بگویید.',
  cartDescription: (lines, studentName, total) => {
    const who = studentName ? `به حساب ${studentName}` : 'نقدی';
    return `${lines.join('، ')}؛ ${who}؛ جمع ${tomanWords(total)}. تأیید می‌کنید؟`;
  },
  attachStudent: (name, balance) =>
    `فروش به حساب ${name} با مانده ${describeBalanceFa(balance)}.`,
  confirmNeeded: () => 'تأیید می‌کنید؟ بگویید «ثبت بشه».',
  screenConfirmRequired: () =>
    'برای ثبت، دکمهٔ تأیید روی صفحه را هم بزنید. (در این مرحله، گفتار به‌تنهایی ثبت نمی‌کند.)',
  saleRecorded: (total, balanceAfter) => {
    const parts = [`ثبت شد؛ ${tomanWords(total)}.`];
    if (balanceAfter !== null && balanceAfter !== undefined) {
      parts.push(`مانده جدید ${describeBalanceFa(balanceAfter)}.`);
    }
    return parts.join(' ');
  },
  notConfirmed: () => 'تأیید کامل نشده؛ فروش ثبت نمی‌شود.',
  saleInProgress: () => 'فروش در حال ثبت است؛ لطفاً منتظر نتیجه بمانید.',
  voided: (total, balanceAfter) => {
    const parts = [`فروش ${tomanWords(total)} ابطال شد.`];
    if (balanceAfter !== null && balanceAfter !== undefined) {
      parts.push(`مانده جدید ${describeBalanceFa(balanceAfter)}.`);
    }
    return parts.join(' ');
  },
  nothingToVoid: () => 'فروشی برای ابطال نیست.',
  report: (r) => {
    const parts = [
      `امروز ${r.saleCount} فروش`,
      `درآمد ${tomanWords(r.revenue)}`,
      `سود ${tomanWords(r.profit)}`,
    ];
    if (Math.abs(r.outstandingDebt ?? 0) > 0) {
      parts.push(`بدهی دانش‌آموزان ${tomanWords(Math.abs(r.outstandingDebt))}`);
    }
    return `${parts.join('، ')}.`;
  },
  handover: () =>
    'متوجه نشدم. اپراتور کنار دستگاه کمکتان می‌کند؛ با صفحه هم می‌توانید کار کنید.',
  unrecognized: () => 'متوجه نشدم؛ دوباره بگویید.',
  langSwitched: (lang) => (lang === 'fa' ? 'فارسی شد.' : 'English now.'),
  stageReadOnly: () => 'در این مرحله، گفتار فقط اطلاع‌رسانی است و چیزی ثبت نمی‌کند.',
  error: () => 'مشکلی پیش آمد؛ لطفاً دوباره تلاش کنید.',
  killNotice: () => 'خاموش شدم.',
  started: (caps) => `آماده‌ام. ${caps}`,
  capabilities: (list) => `قابلیت‌ها: ${list}.`,
};

const en = {
  greeting: () =>
    "Hi! I'm the cafe assistant. Ask for the menu, a balance, or place an order.",
  menuList: (products) =>
    products.length
      ? `${products.map((p) => `${p.name} — ${p.price.toLocaleString('en-US')} toman`).join(', ')}.`
      : 'The cafe has no products yet.',
  balance: (balance) => `The balance is ${describeBalanceEn(balance)}.`,
  studentFound: (name, balance) => `Found ${name}; balance ${describeBalanceEn(balance)}.`,
  studentNotFound: () => 'No student by that name.',
  studentAmbiguous: (n) => `Found ${n} students; say which one.`,
  added: (product) => `${product.name} added.`,
  notInMenu: () => "That's not on the menu.",
  removed: () => 'Removed.',
  notInCart: () => "That's not in the cart.",
  invalidQty: () => "That quantity doesn't look right.",
  emptyCart: () => 'The cart is empty.',
  canceled: () => 'Canceled; the cart is empty.',
  balanceWho: () => 'Whose balance? Say a name or code.',
  cartDescription: (lines, studentName, total) => {
    const who = studentName ? `charging ${studentName}` : 'cash';
    return `${lines.join(', ')}; ${who}; total ${total.toLocaleString('en-US')} toman. Do you confirm?`;
  },
  attachStudent: (name, balance) =>
    `Charging ${name}, balance ${describeBalanceEn(balance)}.`,
  confirmNeeded: () => 'Do you confirm? Say "confirm".',
  screenConfirmRequired: () =>
    'Also press Confirm on the screen to record it. (At this stage, speech alone never records.)',
  saleRecorded: (total, balanceAfter) => {
    const parts = [`Recorded — ${total.toLocaleString('en-US')} toman.`];
    if (balanceAfter !== null && balanceAfter !== undefined) {
      parts.push(`New balance ${describeBalanceEn(balanceAfter)}.`);
    }
    return parts.join(' ');
  },
  notConfirmed: () => 'Not fully confirmed; nothing was recorded.',
  saleInProgress: () => 'The sale is being recorded; please wait for the result.',
  voided: (total, balanceAfter) => {
    const parts = [`The ${total.toLocaleString('en-US')} toman sale was voided.`];
    if (balanceAfter !== null && balanceAfter !== undefined) {
      parts.push(`New balance ${describeBalanceEn(balanceAfter)}.`);
    }
    return parts.join(' ');
  },
  nothingToVoid: () => "There's no sale to void.",
  report: (r) => {
    const parts = [
      `Today: ${r.saleCount} sales`,
      `revenue ${r.revenue.toLocaleString('en-US')}`,
      `profit ${r.profit.toLocaleString('en-US')} toman`,
    ];
    if (Math.abs(r.outstandingDebt ?? 0) > 0) {
      parts.push(`student debt ${Math.abs(r.outstandingDebt).toLocaleString('en-US')} toman`);
    }
    return `${parts.join(', ')}.`;
  },
  handover: () =>
    "Sorry, I didn't follow. The operator here can help, and the screen works too.",
  unrecognized: () => "Sorry, I didn't catch that. Say it again?",
  langSwitched: (lang) => (lang === 'fa' ? 'فارسی شد.' : 'English now.'),
  stageReadOnly: () =>
    'At this stage speech only informs — nothing gets recorded by voice.',
  error: () => 'Something went wrong; please try again.',
  killNotice: () => 'Shutting down.',
  started: (caps) => `Ready. ${caps}`,
  capabilities: (list) => `Capabilities: ${list}.`,
};

function describeBalanceFa(balance) {
  if (balance < 0) return `${tomanWords(-balance)} بدهکار`;
  return tomanWords(balance);
}
function describeBalanceEn(balance) {
  const amount = Math.abs(balance).toLocaleString('en-US');
  return balance < 0 ? `${amount} toman in debt` : `${amount} toman`;
}

const CATALOGUES = { fa, en };

// The dialogue asks for phrases in ONE language at a time; a missing key in
// one language is a programming error — both trees must stay identical
// (checked by the tests).
export function phrases(language) {
  return CATALOGUES[language === 'en' ? 'en' : 'fa'];
}

// Script-based language detection: any Persian/Arabic-block letter → fa;
// otherwise en. A bare number or «ok» stays in the session language.
export function detectLanguage(text, fallback) {
  return /[\u0600-\u06FF]/.test(text) ? 'fa' : /[\u0041-\u005A\u0061-\u007A]/.test(text) ? 'en' : fallback;
}
