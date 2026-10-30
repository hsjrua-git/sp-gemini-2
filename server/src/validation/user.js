import { isUuid } from '../lib/ids.js';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

export function parseUsername(input) {
  if (typeof input !== 'string') {
    return { error: 'Username is required.', code: 'VALIDATION_REQUIRED' };
  }
  const value = input.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(value)) {
    return {
      error:
        'Username must be 3 to 32 characters: letters, digits, dots, dashes or underscores.',
      code: 'VALIDATION_INVALID_LENGTH',
      params: { min: 3, max: 32 },
    };
  }
  return { value };
}

export function parseFullName(input) {
  if (typeof input !== 'string') {
    return { error: 'Full name is required.', code: 'VALIDATION_REQUIRED' };
  }
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < 1 || value.length > 100) {
    return {
      error: 'Full name must be 1 to 100 characters.',
      code: 'VALIDATION_INVALID_LENGTH',
      params: { min: 1, max: 100 },
    };
  }
  return { value };
}

export function parseNewUser(body) {
  const username = parseUsername(body?.username);
  if (username.error) {
    return {
      error: username.error,
      code: username.code,
      params: username.params,
    };
  }
  const fullName = parseFullName(body?.fullName);
  if (fullName.error) {
    return {
      error: fullName.error,
      code: fullName.code,
      params: fullName.params,
    };
  }
  if (!isUuid(body?.roleId)) {
    return { error: 'Choose a role.', code: 'VALIDATION_REQUIRED' };
  }
  return {
    values: {
      username: username.value,
      fullName: fullName.value,
      roleId: body.roleId,
    },
  };
}

export function parseUserUpdate(body) {
  const input = body !== null && typeof body === 'object' ? body : {};
  if ('username' in input) {
    return { error: 'Usernames cannot be changed.', code: 'USERS_USERNAME_IMMUTABLE' };
  }

  const values = {};
  if ('fullName' in input) {
    const name = parseFullName(input.fullName);
    if (name.error) {
      return { error: name.error, code: name.code, params: name.params };
    }
    values.fullName = name.value;
  }
  if ('roleId' in input) {
    if (!isUuid(input.roleId)) {
      return { error: 'Choose a role.', code: 'VALIDATION_REQUIRED' };
    }
    values.roleId = input.roleId;
  }
  if ('isActive' in input) {
    if (typeof input.isActive !== 'boolean') {
      return {
        error: 'isActive must be true or false.',
        code: 'VALIDATION_INVALID_TYPE',
      };
    }
    values.isActive = input.isActive;
  }

  if (Object.keys(values).length === 0) {
    return { error: 'Nothing to change.', code: 'VALIDATION_NOTHING_TO_CHANGE' };
  }
  return { values };
}
