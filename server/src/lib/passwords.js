import { randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

const ALPHABET =
  '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';

export function hashPassword(password) {
  return hash(password);
}

export async function verifyPassword(hashVal, password) {
  try {
    return await verify(hashVal, password);
  } catch {
    return false;
  }
}

export function generatePassword(length = 16) {
  let password = '';
  for (let i = 0; i < length; i++) {
    password += ALPHABET[randomInt(ALPHABET.length)];
  }
  return password;
}

export function validateNewPassword(password, { username } = {}) {
  if (typeof password !== 'string') {
    return { error: 'A new password is required.', code: 'AUTH_PASSWORD_REQUIRED' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      code: 'AUTH_PASSWORD_TOO_SHORT',
      params: { min: MIN_PASSWORD_LENGTH },
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      error: `The password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
      code: 'AUTH_PASSWORD_TOO_LONG',
      params: { max: MAX_PASSWORD_LENGTH },
    };
  }
  if (username && password.toLowerCase() === username.toLowerCase()) {
    return {
      error: 'The password cannot be the same as the username.',
      code: 'AUTH_PASSWORD_SAME_AS_USERNAME',
    };
  }
  return null;
}