import { isPermissionKey } from '../lib/permissions.js';

export function parseRoleName(input) {
  if (typeof input !== 'string') {
    return { error: 'Role name is required.', code: 'VALIDATION_REQUIRED' };
  }
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < 1 || value.length > 50) {
    return {
      error: 'Role name must be 1 to 50 characters.',
      code: 'VALIDATION_INVALID_LENGTH',
      params: { min: 1, max: 50 },
    };
  }
  return { value };
}

export function parseDescription(input) {
  if (input === undefined || input === null) return { value: '' };
  if (typeof input !== 'string') {
    return { error: 'Description must be text.', code: 'VALIDATION_INVALID_TYPE' };
  }
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length > 200) {
    return {
      error: 'Description must be 200 characters or fewer.',
      code: 'VALIDATION_TOO_LONG',
      params: { max: 200 },
    };
  }
  return { value };
}

export function parsePermissions(input) {
  if (!Array.isArray(input)) {
    return { error: 'Permissions must be a list.', code: 'VALIDATION_INVALID_TYPE' };
  }
  const seen = new Set();
  for (const key of input) {
    if (!isPermissionKey(key)) {
      return {
        error: `Unknown permission: ${String(key)}.`,
        code: 'VALIDATION_INVALID_CHOICE',
        params: { key: String(key) },
      };
    }
    seen.add(key);
  }
  return { value: [...seen] };
}

export function parseNewRole(body) {
  const name = parseRoleName(body?.name);
  if (name.error) {
    return { error: name.error, code: name.code, params: name.params };
  }
  const description = parseDescription(body?.description);
  if (description.error) {
    return {
      error: description.error,
      code: description.code,
      params: description.params,
    };
  }
  const permissions = parsePermissions(body?.permissions ?? []);
  if (permissions.error) {
    return {
      error: permissions.error,
      code: permissions.code,
      params: permissions.params,
    };
  }
  return {
    values: {
      name: name.value,
      description: description.value,
      permissions: permissions.value,
    },
  };
}

export function parseRoleUpdate(body) {
  const input = body !== null && typeof body === 'object' ? body : {};
  const values = {};
  if ('name' in input) {
    const name = parseRoleName(input.name);
    if (name.error) {
      return { error: name.error, code: name.code, params: name.params };
    }
    values.name = name.value;
  }
  if ('description' in input) {
    const description = parseDescription(input.description);
    if (description.error) {
      return {
        error: description.error,
        code: description.code,
        params: description.params,
      };
    }
    values.description = description.value;
  }
  if ('permissions' in input) {
    const permissions = parsePermissions(input.permissions);
    if (permissions.error) {
      return {
        error: permissions.error,
        code: permissions.code,
        params: permissions.params,
      };
    }
    values.permissions = permissions.value;
  }
  if (Object.keys(values).length === 0) {
    return { error: 'Nothing to change.', code: 'VALIDATION_NOTHING_TO_CHANGE' };
  }
  return { values };
}
