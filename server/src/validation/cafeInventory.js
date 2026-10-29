// Inventory corrections: waste (stock out at the current average cost —
// the loss is valued) and adjustments (signed count corrections, valued at
// 0 because they fix the ledger, not the goods). Both are new append-only
// movements; nothing is ever rewritten.

import { isUuid } from '../lib/ids.js';
import { hasQuantityPrecision } from '../lib/quantity.js';

const MAX_MONEY = 1_000_000_000_000;
const MAX_QTY = 100_000;
const MAX_ITEMS = 50;

function parseQty(value) {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty === 0 || Math.abs(qty) > MAX_QTY) {
    return {
      error: `Quantity must be non-zero and at most ${MAX_QTY}.`,
      code: 'VALIDATION_INVALID_RANGE',
      params: { max: MAX_QTY },
    };
  }
  if (!hasQuantityPrecision(qty)) {
    return { error: 'Quantity accepts at most three decimals.', code: 'VALIDATION_INVALID_FORMAT' };
  }
  return { value: qty };
}

// { kind: 'waste'|'adjustment', items: [{ productId, qty, note? }], note? }.
// Waste quantities are POSITIVE (the amount thrown away); adjustments are
// signed (found extra = +, missing = -).
export function parseInventoryBody(body) {
  const kind = body?.kind;
  if (kind !== 'waste' && kind !== 'adjustment') {
    return {
      error: 'kind must be waste or adjustment.',
      code: 'VALIDATION_INVALID_CHOICE',
    };
  }

  const items = body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    return {
      error: `items must be 1 to ${MAX_ITEMS} lines.`,
      code: 'VALIDATION_INVALID_LENGTH',
      params: { min: 1, max: MAX_ITEMS },
    };
  }

  const parsedItems = [];
  for (const item of items) {
    if (!isUuid(item?.productId)) {
      return { error: 'Every item needs a product.', code: 'VALIDATION_REQUIRED' };
    }
    const qty = parseQty(item?.qty);
    if (qty.error) return qty;
    if (kind === 'waste' && qty.value < 0) {
      return {
        error: 'Waste is recorded as a positive amount.',
        code: 'VALIDATION_INVALID_RANGE',
      };
    }
    if (parsedItems.some((seen) => seen.productId === item.productId)) {
      return {
        error: 'Each product may appear once; merge duplicate lines.',
        code: 'VALIDATION_NOT_UNIQUE',
      };
    }
    parsedItems.push({ productId: item.productId, qty: qty.value });
  }

  const note = body?.note;
  if (
    note !== undefined &&
    note !== null &&
    String(note).trim() !== '' &&
    (typeof note !== 'string' || note.trim().length > 500)
  ) {
    return {
      error: 'Note must be 500 characters or fewer.',
      code: 'VALIDATION_TOO_LONG',
      params: { max: 500 },
    };
  }

  return {
    value: {
      kind,
      items: parsedItems,
      note: note === undefined || note === null || String(note).trim() === ''
        ? null
        : note.trim(),
    },
  };
}
