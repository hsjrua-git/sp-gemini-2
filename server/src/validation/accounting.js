// Accounting validation. Codes are short text; amounts whole Toman. The
// journal-entry line rules live in lib/accountingJournal.js (they are shared
// with the engine's internal normalizeLines).

import { isUuid } from '../lib/ids.js';
import { isValidIsoDate } from '../lib/periods.js';

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];

export function parseAccountBody(rawBody, { partial = false } = {}) {
  const body =
    rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? rawBody
      : {};
  const updates = {};

  if (!partial || 'code' in body) {
    if (typeof body?.code !== 'string') {
      return { error: 'Code is required.', code: 'VALIDATION_REQUIRED' };
    }
    const code = body.code.trim();
    if (code.length < 1 || code.length > 20) {
      return {
        error: 'Code must be 1 to 20 characters.',
        code: 'VALIDATION_INVALID_LENGTH',
        params: { min: 1, max: 20 },
      };
    }
    updates.code = code;
  }

  if (!partial || 'name' in body) {
    if (typeof body?.name !== 'string') {
      return { error: 'Name is required.', code: 'VALIDATION_REQUIRED' };
    }
    const name = body.name.trim().replace(/\s+/g, ' ');
    if (name.length < 1 || name.length > 120) {
      return {
        error: 'Name must be 1 to 120 characters.',
        code: 'VALIDATION_INVALID_LENGTH',
        params: { min: 1, max: 120 },
      };
    }
    updates.name = name;
  }

  if (!partial || 'type' in body) {
    if (!TYPES.includes(body?.type)) {
      return {
        error: 'Type must be asset, liability, equity, income or expense.',
        code: 'VALIDATION_INVALID_CHOICE',
      };
    }
    updates.type = body.type;
  }

  if ('parentId' in body) {
    const parentId = body.parentId;
    if (parentId === null || parentId === undefined || parentId === '') {
      updates.parentId = null;
    } else if (!isUuid(parentId)) {
      return { error: 'parentId must be a valid ID.', code: 'VALIDATION_INVALID_FORMAT' };
    } else {
      updates.parentId = parentId;
    }
  }

  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') {
      return { error: 'isActive must be true or false.', code: 'VALIDATION_INVALID_TYPE' };
    }
    updates.isActive = body.isActive;
  }

  if (Object.keys(updates).length === 0) {
    return { error: 'Nothing to change.', code: 'VALIDATION_NOTHING_TO_CHANGE' };
  }
  return { value: updates };
}

export function parseMappingBody(rawBody) {
  const body =
    rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? rawBody
      : {};
  const updates = {};
  if ('debitAccountId' in body) {
    if (!isUuid(body?.debitAccountId)) {
      return { error: 'debitAccountId must be a valid ID.', code: 'VALIDATION_INVALID_FORMAT' };
    }
    updates.debitAccountId = body.debitAccountId;
  }
  if ('creditAccountId' in body) {
    if (!isUuid(body?.creditAccountId)) {
      return { error: 'creditAccountId must be a valid ID.', code: 'VALIDATION_INVALID_FORMAT' };
    }
    updates.creditAccountId = body.creditAccountId;
  }
  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') {
      return { error: 'isActive must be true or false.', code: 'VALIDATION_INVALID_TYPE' };
    }
    updates.isActive = body.isActive;
  }
  if (Object.keys(updates).length === 0) {
    return { error: 'Nothing to change.', code: 'VALIDATION_NOTHING_TO_CHANGE' };
  }
  return { value: updates };
}

export function parsePeriodBody(rawBody, { partial = false } = {}) {
  const body =
    rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? rawBody
      : {};
  const updates = {};

  if (!partial || 'name' in body) {
    if (typeof body?.name !== 'string') {
      return { error: 'Name is required.', code: 'VALIDATION_REQUIRED' };
    }
    const name = body.name.trim().replace(/\s+/g, ' ');
    if (name.length < 1 || name.length > 80) {
      return {
        error: 'Name must be 1 to 80 characters.',
        code: 'VALIDATION_INVALID_LENGTH',
        params: { min: 1, max: 80 },
      };
    }
    updates.name = name;
  }

  if (!partial || 'startDate' in (body ?? {})) {
    if (!isValidIsoDate(body?.startDate)) {
      return {
        error: 'startDate must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
      };
    }
    updates.startDate = body.startDate;
  }

  if (!partial || 'endDate' in (body ?? {})) {
    if (!isValidIsoDate(body?.endDate)) {
      return {
        error: 'endDate must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
      };
    }
    updates.endDate = body.endDate;
  }

  if (updates.startDate && updates.endDate && updates.startDate > updates.endDate) {
    return {
      error: 'The period cannot end before it starts.',
      code: 'ACCOUNTING_PERIOD_RANGE',
    };
  }

  if (Object.keys(updates).length === 0) {
    return { error: 'Nothing to change.', code: 'VALIDATION_NOTHING_TO_CHANGE' };
  }
  return { value: updates };
}
