import { describe, expect, it } from 'vitest';
import { ApiError, isNotFound, visitorMessage } from './errors';

describe('visitorMessage', () => {
  it("shows the API's own message", () => {
    const err = new ApiError('Invalid password', 401, 'Invalid password');
    expect(visitorMessage(err, 'fallback')).toBe('Invalid password');
  });

  it('hides a status line the API did not write', () => {
    const err = new ApiError('API request failed: 502 Bad Gateway', 502);
    expect(visitorMessage(err, 'fallback')).toBe('fallback');
  });

  it('hides network and parse errors', () => {
    expect(visitorMessage(new TypeError('Failed to fetch'), 'fallback')).toBe('fallback');
    expect(visitorMessage(new SyntaxError('Unexpected token <'), 'fallback')).toBe('fallback');
  });
});

describe('isNotFound', () => {
  it('is true only for an API 404', () => {
    expect(isNotFound(new ApiError('API request failed: 404 Not Found', 404))).toBe(true);
    expect(isNotFound(new ApiError('API request failed: 500', 500))).toBe(false);
    expect(isNotFound(new Error('404'))).toBe(false);
  });
});
