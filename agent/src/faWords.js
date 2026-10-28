// Numbers to Persian words, so prices are SPOKEN correctly («دویست و پنجاه
// هزار تومان»). Digits stay Latin on screens; this module is only for what
// the agent says or synthesizes.

const ONES = [
  'صفر', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه',
  'ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده',
  'هفده', 'هجده', 'نوزده',
];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = [
  '', 'یکصد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد',
];
const SCALES = [
  { size: 1_000_000_000, name: 'میلیارد' },
  { size: 1_000_000, name: 'میلیون' },
  { size: 1_000, name: 'هزار' },
];

function below1000(n) {
  const parts = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(HUNDREDS[hundreds]);
  if (rest > 0) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const tens = Math.floor(rest / 10);
      const ones = rest % 10;
      parts.push(ones > 0 ? `${TENS[tens]} و ${ONES[ones]}` : TENS[tens]);
    }
  }
  return parts.join(' و ');
}

// 0 ≤ n ≤ 999_999_999_999 (the money sanity cap is 10^12).
export function toPersianWords(n) {
  if (!Number.isInteger(n) || n < 0) return null;
  if (n === 0) return ONES[0];
  const parts = [];
  for (const scale of SCALES) {
    if (n >= scale.size) {
      const count = Math.floor(n / scale.size);
      n %= scale.size;
      parts.push(`${below1000(count)} ${scale.name}`);
    }
  }
  if (n > 0) parts.push(below1000(n));
  return parts.join(' و ');
}

// «... تومان» with the currency, the way the agent says prices.
export function tomanWords(n) {
  const words = toPersianWords(n);
  return words === null ? null : `${words} تومان`;
}
