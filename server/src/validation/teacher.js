import { isValidIsoDate, todayIso } from '../lib/periods.js';
import { normalizeFullName } from './student.js';

// Teachers carry full identity from the start (unlike students, whose
// identity columns are filled in gradually): both birth date and national ID
// are required.

function requiredBirthDate(input) {
  if (typeof input !== 'string' || !isValidIsoDate(input)) {
    return {
      error: 'Birth date must be a valid date (YYYY-MM-DD).',
      code: 'VALIDATION_INVALID_DATE',
    };
  }
  if (input > todayIso()) {
    return {
      error: 'Birth date cannot be in the future.',
      code: 'VALIDATION_DATE_IN_FUTURE',
    };
  }
  return { value: input };
}

function requiredNationalId(input) {
  if (typeof input !== 'string' || !/^[0-9]{10}$/.test(input)) {
    return {
      error: 'National ID must be exactly 10 digits.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { length: 10 },
    };
  }
  return { value: input };
}

// Validate the full teacher record for creation.
export function parseNewTeacher(body) {
  const fullName = normalizeFullName(body?.fullName);
  if (fullName.error) return fullName;
  const birthDate = requiredBirthDate(body?.birthDate);
  if (birthDate.error) return birthDate;
  const nationalId = requiredNationalId(body?.nationalId);
  if (nationalId.error) return nationalId;
  return {
    value: {
      fullName: fullName.value,
      birthDate: birthDate.value,
      nationalId: nationalId.value,
    },
  };
}

// Validate a partial update (each field present in the body).
export function parseTeacherUpdate(body) {
  const input =
    body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const updates = {};
  if ('fullName' in input) {
    const fullName = normalizeFullName(input.fullName);
    if (fullName.error) return fullName;
    updates.fullName = fullName.value;
  }
  if ('birthDate' in input) {
    const birthDate = requiredBirthDate(input.birthDate);
    if (birthDate.error) return birthDate;
    updates.birthDate = birthDate.value;
  }
  if ('nationalId' in input) {
    const nationalId = requiredNationalId(input.nationalId);
    if (nationalId.error) return nationalId;
    updates.nationalId = nationalId.value;
  }
  if ('archived' in input) {
    if (typeof input.archived !== 'boolean') {
      return {
        error: 'archived must be true or false.',
        code: 'VALIDATION_INVALID_TYPE',
      };
    }
    updates.archived = input.archived;
  }
  if (Object.keys(updates).length === 0) {
    return { error: 'Nothing to change.', code: 'VALIDATION_NOTHING_TO_CHANGE' };
  }
  return { value: updates };
}
