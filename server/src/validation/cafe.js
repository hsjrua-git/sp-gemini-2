// Cafe validation. Money is Toman whole numbers (integer, sanity-capped well
// below bigint's ceiling); names trim to a single line. Quantities accept up
// to three decimals (weight/portion goods).

import { isUuid } from '../lib/ids.js';
import { isValidIsoDate } from '../lib/periods.js';

const MAX_MONEY = 1_000_000_000_000; // 10^12 Toman — far past any real price
const MAX_QTY = 100_000;
const MAX_ITEMS = 50;

function parseName(body, label) {
  if (typeof body?.name !== 'string') {
    return { error: `${label} is required.`, code: 'VALIDATION_REQUIRED' };
  }
  const name = body.name.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 80) {
    return {
      error: `${label} must be 1 to 80 characters.`,
      code: 'VALIDATION_INVALID_LENGTH',
      params: { min: 1, max: 80 },
    };
  }
  return { value: name };
}

function parsePrice(body, { partial }) {
  if (partial && !('price' in body)) return { skip: true };
  const price = body?.price;
  if (!Number.isInteger(price) || price < 0) {
    return {
      error: 'Price must be a whole number of Toman (0 or more).',
      code: 'VALIDATION_INVALID_RANGE',
    };
  }
  if (price > MAX_MONEY) {
    return {
      error: 'Price is unreasonably large.',
      code: 'VALIDATION_INVALID_RANGE',
      params: { max: MAX_MONEY },
    };
  }
  return { value: price };
}

function parseSortOrder(body) {
  if (!('sortOrder' in body)) return { skip: true };
  if (!Number.isInteger(body.sortOrder) || body.sortOrder < 0) {
    return { error: 'Sort order must be a whole number from 0.', code: 'VALIDATION_INVALID_TYPE' };
  }
  return { value: body.sortOrder };
}

function parseIsActive(body) {
  if (!('isActive' in body)) return { skip: true };
  if (typeof body.isActive !== 'boolean') {
    return { error: 'isActive must be true or false.', code: 'VALIDATION_INVALID_TYPE' };
  }
  return { value: body.isActive };
}

function parseOptionalText(body, key, max, label) {
  if (!(key in body)) return { skip: true };
  const value = body[key];
  if (value === undefined || value === null || String(value).trim() === '') {
    return { value: null };
  }
  if (typeof value !== 'string' || value.trim().length > max) {
    return {
      error: `${label} must be ${max} characters or fewer.`,
      code: 'VALIDATION_TOO_LONG',
      params: { max },
    };
  }
  return { value: value.trim() };
}

export function parseProductBody(rawBody, { partial = false } = {}) {
  const body =
    rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? rawBody
      : {};
  const updates = {};

  if (!partial || 'name' in body) {
    const name = parseName(body, 'Product name');
    if (name.error) return name;
    updates.name = name.value;
  }
  const price = parsePrice(body, { partial });
  if (price.error) return price;
  if (!price.skip) updates.price = price.value;

  const sort = parseSortOrder(body);
  if (sort.error) return sort;
  if (!sort.skip) updates.sortOrder = sort.value;

  const active = parseIsActive(body);
  if (active.error) return active;
  if (!active.skip) updates.isActive = active.value;

  if (Object.keys(updates).length === 0) {
    return { error: 'Nothing to change.', code: 'VALIDATION_NOTHING_TO_CHANGE' };
  }
  return { value: updates };
}

export function parseSupplierBody(rawBody, { partial = false } = {}) {
  const body =
    rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? rawBody
      : {};
  const updates = {};

  if (!partial || 'name' in body) {
    const name = parseName(body, 'Supplier name');
    if (name.error) return name;
    updates.name = name.value;
  }

  const phone = parseOptionalText(body, 'phone', 30, 'Phone');
  if (phone.error) return phone;
  if (!phone.skip) updates.phone = phone.value;

  const note = parseOptionalText(body, 'note', 500, 'Note');
  if (note.error) return note;
  if (!note.skip) updates.note = note.value;

  const active = parseIsActive(body);
  if (active.error) return active;
  if (!active.skip) updates.isActive = active.value;

  if (Object.keys(updates).length === 0) {
    return { error: 'Nothing to change.', code: 'VALIDATION_NOTHING_TO_CHANGE' };
  }
  return { value: updates };
}

// A purchase is written once and never edited: { supplierId, note?,
// purchasedAt?, items: [{ productId, qty, unitCost }] }.
export function parsePurchaseBody(rawBody) {
  const body =
    rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? rawBody
      : {};
  if (!isUuid(body?.supplierId)) {
    return { error: 'Choose a supplier.', code: 'VALIDATION_REQUIRED' };
  }
  const updates = { supplierId: body.supplierId };

  const note = parseOptionalText(body, 'note', 500, 'Note');
  if (note.error) return note;
  if (!note.skip) updates.note = note.value;

  if ('purchasedAt' in body && body.purchasedAt != null) {
    if (!isValidIsoDate(body.purchasedAt)) {
      return {
        error: 'purchasedAt must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
      };
    }
    updates.purchasedAt = body.purchasedAt;
  }

  const items = body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    return {
      error: `items must be 1 to ${MAX_ITEMS} purchase lines.`,
      code: 'VALIDATION_INVALID_LENGTH',
      params: { min: 1, max: MAX_ITEMS },
    };
  }
  const parsedItems = [];
  for (const item of items) {
    if (!isUuid(item?.productId)) {
      return { error: 'Every item needs a product.', code: 'VALIDATION_REQUIRED' };
    }
    const qty = Number(item?.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) {
      return {
        error: `Quantity must be greater than 0 and at most ${MAX_QTY}.`,
        code: 'VALIDATION_INVALID_RANGE',
        params: { max: MAX_QTY },
      };
    }
    if (Math.round(qty * 1000) !== qty * 1000) {
      return {
        error: 'Quantity accepts at most three decimals.',
        code: 'VALIDATION_INVALID_FORMAT',
      };
    }
    const unitCost = item?.unitCost;
    if (!Number.isInteger(unitCost) || unitCost < 0 || unitCost > MAX_MONEY) {
      return {
        error: 'Unit cost must be a whole number of Toman (0 or more).',
        code: 'VALIDATION_INVALID_RANGE',
      };
    }
    if (parsedItems.some((seen) => seen.productId === item.productId)) {
      return {
        error: 'Each product may appear once; merge duplicate lines.',
        code: 'VALIDATION_NOT_UNIQUE',
      };
    }
    parsedItems.push({ productId: item.productId, qty, unitCost });
  }
  updates.items = parsedItems;

  return { value: updates };
}

function parseQty(qty) {
  const value = Number(qty);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_QTY) {
    return {
      error: `Quantity must be greater than 0 and at most ${MAX_QTY}.`,
      code: 'VALIDATION_INVALID_RANGE',
      params: { max: MAX_QTY },
    };
  }
  if (Math.round(value * 1000) !== value * 1000) {
    return { error: 'Quantity accepts at most three decimals.', code: 'VALIDATION_INVALID_FORMAT' };
  }
  return { value };
}

// A sale: { customer: 'walk_in'|'student', studentId (iff student), items:
// [{ productId, qty, unitPrice? }], note? }. The unit price defaults to the
// product's current price; an explicit price covers bartered/adjusted POS
// lines.
export function parseSaleBody(body) {
  const customer = body?.customer;
  if (customer !== 'walk_in' && customer !== 'student') {
    return {
      error: 'customer must be walk_in or student.',
      code: 'VALIDATION_INVALID_CHOICE',
    };
  }
  const updates = { customer };

  if (customer === 'student') {
    if (!isUuid(body?.studentId)) {
      return { error: 'Choose the student.', code: 'VALIDATION_REQUIRED' };
    }
    updates.studentId = body.studentId;
  }

  const note = parseOptionalText(body ?? {}, 'note', 500, 'Note');
  if (note.error) return note;
  if (!note.skip) updates.note = note.value;

  const items = body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    return {
      error: `items must be 1 to ${MAX_ITEMS} sale lines.`,
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
    if (item?.unitPrice !== undefined) {
      if (!Number.isInteger(item.unitPrice) || item.unitPrice < 0 || item.unitPrice > MAX_MONEY) {
        return {
          error: 'Unit price must be a whole number of Toman (0 or more).',
          code: 'VALIDATION_INVALID_RANGE',
        };
      }
    }
    if (parsedItems.some((seen) => seen.productId === item.productId)) {
      return {
        error: 'Each product may appear once; merge duplicate lines.',
        code: 'VALIDATION_NOT_UNIQUE',
      };
    }
    parsedItems.push({
      productId: item.productId,
      qty: qty.value,
      unitPrice: item?.unitPrice,
    });
  }
  updates.items = parsedItems;

  return { value: updates };
}

// A manual balance event: { studentId, kind: topup|refund|adjustment, amount,
// note? }. topup/refund carry positive amounts; adjustment is signed (it can
// correct in either direction).
export function parseBalanceBody(body) {
  if (!isUuid(body?.studentId)) {
    return { error: 'Choose the student.', code: 'VALIDATION_REQUIRED' };
  }
  const kind = body?.kind;
  if (!['topup', 'refund', 'adjustment'].includes(kind)) {
    return {
      error: 'kind must be topup, refund or adjustment.',
      code: 'VALIDATION_INVALID_CHOICE',
    };
  }
  const amount = body?.amount;
  if (!Number.isInteger(amount) || Math.abs(amount) > MAX_MONEY) {
    return {
      error: 'Amount must be a whole number of Toman.',
      code: 'VALIDATION_INVALID_RANGE',
    };
  }
  if ((kind === 'topup' || kind === 'refund') && amount <= 0) {
    return {
      error: `${kind === 'topup' ? 'Top-ups' : 'Refunds'} need a positive amount.`,
      code: 'VALIDATION_INVALID_RANGE',
    };
  }
  if (kind === 'adjustment' && amount === 0) {
    return { error: 'An adjustment cannot be zero.', code: 'VALIDATION_INVALID_RANGE' };
  }

  const note = parseOptionalText(body ?? {}, 'note', 500, 'Note');
  if (note.error) return note;

  return {
    value: {
      studentId: body.studentId,
      kind,
      amount,
      note: note.skip ? null : note.value,
    },
  };
}
