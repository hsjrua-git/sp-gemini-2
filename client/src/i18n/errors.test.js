import { describe, expect, it } from 'vitest';
import i18next from './index.js';
import { errorMessage } from './errors.js';

describe('errorMessage', () => {
  it('translates a known code and interpolates params', () => {
    i18next.changeLanguage('fa');
    expect(errorMessage({ code: 'AUTH_SIGNIN_REQUIRED', message: 'x' })).toBe(
      'لطفاً وارد شوید.'
    );
    expect(
      errorMessage({
        code: 'VALIDATION_TOO_LONG',
        message: 'x',
        params: { max: 500 },
      })
    ).toBe('حداکثر 500 نویسه مجاز است.');
  });

  it('translates the entity param into the active language', () => {
    i18next.changeLanguage('fa');
    expect(
      errorMessage({
        code: 'NOT_FOUND',
        message: 'Session not found.',
        params: { entity: 'session' },
      })
    ).toBe('جلسه پیدا نشد.');
  });

  it('falls back to the server message for unknown or missing codes', () => {
    i18next.changeLanguage('fa');
    expect(errorMessage({ message: 'Something specific.' })).toBe(
      'Something specific.'
    );
    expect(
      errorMessage({ code: 'NOT_A_REAL_CODE', message: 'Plain words.' })
    ).toBe('Plain words.');
    expect(errorMessage(null)).toBe('');
  });
});
