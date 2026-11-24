import { describe, expect, it } from 'vitest';
import { CONTACT_EMAIL_ERROR, INSTAGRAM_URL_ERROR, validateSiteLinks } from './siteLinks';

describe('validateSiteLinks', () => {
  it('leaves out fields that were not sent', () => {
    expect(validateSiteLinks({})).toEqual({ ok: true, values: {} });
  });

  it('accepts empty values, which clear a link', () => {
    expect(validateSiteLinks({ instagram_url: '', contact_email: '  ' })).toEqual({
      ok: true,
      values: { instagram_url: '', contact_email: '' },
    });
  });

  it('accepts and trims https Instagram links', () => {
    for (const url of [
      'https://instagram.com/jacobfain',
      'https://www.instagram.com/jacobfain/',
      'https://WWW.Instagram.com/jacobfain',
    ]) {
      expect(validateSiteLinks({ instagram_url: ` ${url} ` })).toEqual({
        ok: true,
        values: { instagram_url: url },
      });
    }
  });

  it('rejects links that are not https on instagram.com', () => {
    for (const url of [
      'http://instagram.com/jacobfain',
      'instagram.com/jacobfain',
      'https://instagram.com.evil.example/jacobfain',
      'https://notinstagram.com/jacobfain',
      'https://user:pw@instagram.com/jacobfain',
      'javascript:alert(1)',
      `https://instagram.com/${'a'.repeat(2048)}`,
    ]) {
      expect(validateSiteLinks({ instagram_url: url })).toEqual({ ok: false, error: INSTAGRAM_URL_ERROR });
    }
  });

  it('accepts and trims a plain email address', () => {
    expect(validateSiteLinks({ contact_email: ' hello+site@jacobfain.com ' })).toEqual({
      ok: true,
      values: { contact_email: 'hello+site@jacobfain.com' },
    });
  });

  it('rejects invalid emails, including ones that would add mailto headers', () => {
    for (const email of [
      'not-an-email',
      'a@b',
      'a b@example.com',
      'a@example.com?cc=x@example.com',
      'a&b@example.com',
      `${'a'.repeat(250)}@example.com`,
    ]) {
      expect(validateSiteLinks({ contact_email: email })).toEqual({ ok: false, error: CONTACT_EMAIL_ERROR });
    }
  });

  it('rejects values that are not strings', () => {
    expect(validateSiteLinks({ instagram_url: 42 })).toEqual({ ok: false, error: INSTAGRAM_URL_ERROR });
    expect(validateSiteLinks({ contact_email: null })).toEqual({ ok: false, error: CONTACT_EMAIL_ERROR });
  });
});
