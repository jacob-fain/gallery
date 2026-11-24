import { describe, expect, it } from 'vitest';
import { CONTACT_EMAIL_ERROR, INSTAGRAM_URL_ERROR, siteLinksError } from './siteLinks';

describe('siteLinksError', () => {
  it('allows both fields empty', () => {
    expect(siteLinksError('', ' ')).toBeNull();
  });

  it('allows an https Instagram link and a plain email', () => {
    expect(siteLinksError(' https://www.instagram.com/jacobfain ', 'hello@jacobfain.com')).toBeNull();
  });

  it('names an Instagram link that is not https on instagram.com', () => {
    for (const url of ['http://instagram.com/x', 'https://instagram.com.evil.example/x', 'instagram.com/x']) {
      expect(siteLinksError(url, '')).toBe(INSTAGRAM_URL_ERROR);
    }
  });

  it('names an invalid email, including one that would add mailto headers', () => {
    for (const email of ['nope', 'a@b', 'a@example.com?cc=b@example.com']) {
      expect(siteLinksError('', email)).toBe(CONTACT_EMAIL_ERROR);
    }
  });
});
