// Money and numeric-input helpers shared by every cafe/accounting page.
// Money is whole-number Toman rendered with Latin digits (data, not chrome —
// only the unit word is translated). Inputs accept Persian/Arabic digits and
// the Persian decimal separator, mirroring the server's validation limits.

import { toLatinDigits } from './locale.js';

const amountFormat = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 3,
});
const wholeFormat = new Intl.NumberFormat('en-US');

// An amount with up to three decimals (qty × price), thousands separators.
export function formatAmount(value) {
  return amountFormat.format(Number(value ?? 0));
}

// A whole Toman figure (balances, prices, totals).
export function formatWhole(value) {
  return wholeFormat.format(typeof value === 'bigint' ? value : Number(value ?? 0));
}

// Prices are whole Toman and quantities have at most three decimal places.
// Keep the exact thousandths in BigInt, then round the aggregate once like PG.
export function saleQuote(lines) {
  const thousandths = lines.reduce((sum, { qty, unitPrice }) => {
    if (qty === null || unitPrice === null || !Number.isFinite(qty) ||
        !Number.isSafeInteger(unitPrice)) return sum;
    const scaledQty = BigInt(qty.toFixed(3).replace('.', ''));
    return sum + scaledQty * BigInt(unitPrice);
  }, 0n);
  return (thousandths + 500n) / 1000n;
}

export const MAX_INPUT = 100_000;

// A whole-number Toman field: Persian or Latin digits plus stray separators
// → non-negative integer, or null.
export function parseWholeNumber(text, { signed = false } = {}) {
  const normalized = toLatinDigits(text).replace(/[\s,٬]/g, '');
  const pattern = signed ? /^-?\d+$/ : /^\d+$/;
  return pattern.test(normalized) ? Number(normalized) : null;
}

// A quantity: at most three decimals (weight/portion goods), both decimal
// separators accepted. Positive unless `signed` (stock corrections may be
// negative) — zero is meaningless in every flow and is always rejected.
export function parseQuantity(text, { signed = false, max = MAX_INPUT } = {}) {
  const normalized = toLatinDigits(text)
    .replace(/[\s,٬]/g, '')
    .replace(/٫/g, '.');
  const pattern = signed ? /^-?\d+(?:\.\d{1,3})?$/ : /^\d+(?:\.\d{1,3})?$/;
  if (!pattern.test(normalized)) return null;
  const value = Number(normalized);
  if (value === 0) return null;
  if (!signed && value < 0) return null;
  if (Math.abs(value) > max) return null;
  return value;
}
