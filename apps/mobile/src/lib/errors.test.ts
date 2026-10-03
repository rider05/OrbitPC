import { describe, expect, it } from 'vitest';
import { friendlyError, FRIENDLY_ERRORS } from './errors';

describe('friendlyError', () => {
  it('returns the mapped friendly copy for every known code', () => {
    for (const [code, copy] of Object.entries(FRIENDLY_ERRORS)) {
      expect(friendlyError(code, 'fallback')).toBe(copy);
    }
  });

  it('falls back for unknown / missing codes (never leak raw API errors)', () => {
    expect(friendlyError('DOES_NOT_EXIST', 'fallback')).toBe('fallback');
    expect(friendlyError(null, 'fallback')).toBe('fallback');
    expect(friendlyError(undefined, 'fallback')).toBe('fallback');
  });

  it('has no user-hostile empty strings in the copy table', () => {
    for (const copy of Object.values(FRIENDLY_ERRORS)) {
      expect(copy.trim().length).toBeGreaterThan(8);
    }
  });
});
