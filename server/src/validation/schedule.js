import { isValidIsoDate } from '../lib/periods.js';
import { normalizeFullName } from './student.js';

// Intervals are described structurally ({ everyDays } or { everyMonths }) and
// converted to a Postgres interval string here — a raw interval string from
// the client is never trusted.
export function parseIntervalBody(rawBody, { partial = false } = {}) {
  const body =
    rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? rawBody
      : {};
  const updates = {};

  if (!partial || 'name' in body) {
    if (typeof body?.name !== 'string') {
      return { error: 'Interval name is required.', code: 'VALIDATION_REQUIRED' };
    }
    const name = body.name.trim().replace(/\s+/g, ' ');
    if (name.length < 1 || name.length > 60) {
      return {
        error: 'Interval name must be 1 to 60 characters.',
        code: 'VALIDATION_INVALID_LENGTH',
        params: { min: 1, max: 60 },
      };
    }
    updates.name = name;
  }

  if (!partial || 'everyDays' in body || 'everyMonths' in body) {
    const days = body?.everyDays;
    const months = body?.everyMonths;
    if (Number.isInteger(months) && months >= 1 && months <= 24) {
      updates.every = `${months} month${months === 1 ? '' : 's'}`;
    } else if (Number.isInteger(days) && days >= 1 && days <= 365) {
      updates.every = `${days} day${days === 1 ? '' : 's'}`;
    } else {
      return {
        error: 'Interval length must be 1-365 days or 1-24 months.',
        code: 'VALIDATION_INVALID_RANGE',
      };
    }
  }

  if ('sortOrder' in body) {
    const sort = body.sortOrder;
    if (!Number.isInteger(sort) || sort < 0) {
      return {
        error: 'Sort order must be a whole number from 0.',
        code: 'VALIDATION_INVALID_TYPE',
        params: { field: 'sortOrder' },
      };
    }
    updates.sortOrder = sort;
  }

  if (Object.keys(updates).length === 0) {
    return { error: 'Nothing to change.', code: 'VALIDATION_NOTHING_TO_CHANGE' };
  }
  return { value: updates };
}

function requiredIsoDate(input, label) {
  if (typeof input !== 'string' || !isValidIsoDate(input)) {
    return {
      error: `${label} must be a valid date (YYYY-MM-DD).`,
      code: 'VALIDATION_INVALID_DATE',
      params: { field: 'anchorDate' },
    };
  }
  return { value: input };
}

// Tasks and task templates share their title/description rules.
export function parseTaskFields(rawBody, { partial = false } = {}) {
  const body =
    rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? rawBody
      : {};
  const updates = {};

  if (!partial || 'title' in body) {
    if (typeof body?.title !== 'string') {
      return { error: 'Title is required.', code: 'VALIDATION_REQUIRED' };
    }
    const title = body.title.trim().replace(/\s+/g, ' ');
    if (title.length < 1 || title.length > 120) {
      return {
        error: 'Title must be 1 to 120 characters.',
        code: 'VALIDATION_INVALID_LENGTH',
        params: { min: 1, max: 120 },
      };
    }
    updates.title = title;
  }

  if ('description' in body) {
    const description = body?.description;
    if (description !== undefined && description !== null && description !== '') {
      if (typeof description !== 'string' || description.length > 2000) {
        return {
          error: 'Description must be 2000 characters or fewer.',
          code: 'VALIDATION_TOO_LONG',
          params: { max: 2000 },
        };
      }
      const trimmed = description.trim();
      updates.description = trimmed === '' ? null : trimmed;
    } else {
      updates.description = null;
    }
  }

  if ('sortOrder' in body) {
    if (!Number.isInteger(body.sortOrder) || body.sortOrder < 0) {
      return {
        error: 'Sort order must be a whole number from 0.',
        code: 'VALIDATION_INVALID_TYPE',
        params: { field: 'sortOrder' },
      };
    }
    updates.sortOrder = body.sortOrder;
  }

  // Optional targeting (schema-4): a task or template may point at a
  // parameter and/or a single member. `extra` carries free-form JSON.
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const key of ['parameterId', 'membershipId']) {
    if (key in body) {
      const value = body[key];
      if (value === null || value === '') {
        updates[key] = null;
      } else if (typeof value === 'string' && UUID_PATTERN.test(value)) {
        updates[key] = value;
      } else {
        return {
          error: `${key} must be a valid ID or null.`,
          code: 'VALIDATION_INVALID_FORMAT',
          params: { field: key },
        };
      }
    }
  }
  if ('extra' in body) {
    const extra = body.extra;
    if (extra === null || extra === undefined) {
      updates.extra = {};
    } else if (
      typeof extra === 'object' &&
      !Array.isArray(extra) &&
      Object.keys(extra).every((k) => typeof k === 'string')
    ) {
      updates.extra = extra;
    } else {
      return {
        error: 'extra must be a JSON object.',
        code: 'VALIDATION_INVALID_TYPE',
        params: { field: 'extra' },
      };
    }
  }

  return { value: updates };
}

// An assignment targets a group (groupId) or exactly one membership
// (membershipId); teacherId + intervalId + anchorDate are always required.
// The code may be blank (auto-generated); the name is optional.
export function parseAssignmentBody(rawBody, { partial = false } = {}) {
  const body =
    rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? rawBody
      : {};
  const updates = {};

  if (!partial || 'teacherId' in body) {
    if (typeof body?.teacherId !== 'string') {
      return { error: 'Choose a teacher.', code: 'VALIDATION_REQUIRED' };
    }
    updates.teacherId = body.teacherId;
  }

  if (!partial || 'intervalId' in body) {
    if (typeof body?.intervalId !== 'string') {
      return { error: 'Choose an interval.', code: 'VALIDATION_REQUIRED' };
    }
    updates.intervalId = body.intervalId;
  }

  if (!partial || 'anchorDate' in body) {
    const anchor = requiredIsoDate(body?.anchorDate, 'The anchor date');
    if (anchor.error) return anchor;
    updates.anchorDate = anchor.value;
  }

  if (!partial || 'name' in body) {
    const raw = body?.name;
    if (raw === undefined || raw === null || raw === '') {
      updates.name = null;
    } else {
      const name = normalizeFullName(raw);
      if (name.error) {
        return {
          error: 'Assignment name must be 2 to 100 characters.',
          code: 'VALIDATION_INVALID_LENGTH',
          params: { min: 2, max: 100 },
        };
      }
      updates.name = name.value;
    }
  }

  if (!partial || 'code' in body) {
    if (body?.code === undefined || body?.code === null || String(body.code).trim() === '') {
      if (!partial) updates.code = null; // auto-generate
    } else {
      const code = String(body.code).trim();
      if (code.length < 1 || code.length > 40) {
        return {
          error: 'Assignment code must be 1 to 40 characters.',
          code: 'VALIDATION_INVALID_LENGTH',
          params: { min: 1, max: 40 },
        };
      }
      updates.code = code;
    }
  }

  // Target: exactly one of groupId / membershipId, present on create; on a
  // partial update either key may appear (switching targets is allowed).
  if (!partial) {
    const hasGroup = typeof body?.groupId === 'string';
    const hasMember = typeof body?.membershipId === 'string';
    if (hasGroup === hasMember) {
      return {
        error: 'Choose exactly one target: a group or a single student.',
        code: 'ASSIGNMENTS_TARGET_REQUIRED',
      };
    }
    if (hasGroup) updates.groupId = body.groupId;
    else updates.membershipId = body.membershipId;
  } else {
    if ('groupId' in body) updates.groupId = body.groupId ?? null;
    if ('membershipId' in body) updates.membershipId = body.membershipId ?? null;
    if ('groupId' in body && 'membershipId' in body) {
      const hasGroup = updates.groupId !== null;
      const hasMember = updates.membershipId !== null;
      if (hasGroup === hasMember) {
        return {
          error: 'Choose exactly one target: a group or a single student.',
          code: 'ASSIGNMENTS_TARGET_REQUIRED',
        };
      }
    }
  }

  if ('archived' in body) {
    if (typeof body.archived !== 'boolean') {
      return {
        error: 'archived must be true or false.',
        code: 'VALIDATION_INVALID_TYPE',
      };
    }
    updates.archived = body.archived;
  }

  if ('sortOrder' in body) {
    if (!Number.isInteger(body.sortOrder) || body.sortOrder < 0) {
      return {
        error: 'Sort order must be a whole number from 0.',
        code: 'VALIDATION_INVALID_TYPE',
        params: { field: 'sortOrder' },
      };
    }
    updates.sortOrder = body.sortOrder;
  }

  if (Object.keys(updates).length === 0) {
    return { error: 'Nothing to change.', code: 'VALIDATION_NOTHING_TO_CHANGE' };
  }
  return { value: updates };
}
