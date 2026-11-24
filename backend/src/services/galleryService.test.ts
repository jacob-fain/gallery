import { describe, expect, it } from 'vitest';
import { privateGalleryHasPassword } from './galleryService';

describe('privateGalleryHasPassword', () => {
  it('allows any public gallery', () => {
    expect(privateGalleryHasPassword({ isPublic: true, hasStoredPassword: false, password: null })).toBe(true);
  });

  it('keeps a private gallery valid when an edit leaves the password out', () => {
    // An edit that only renames a private gallery must not strip its password.
    expect(
      privateGalleryHasPassword({ isPublic: false, hasStoredPassword: true, password: undefined })
    ).toBe(true);
  });

  it('refuses a private gallery that has no stored password and none supplied', () => {
    expect(
      privateGalleryHasPassword({ isPublic: false, hasStoredPassword: false, password: undefined })
    ).toBe(false);
  });

  it('refuses removing the password from a gallery that stays private', () => {
    expect(privateGalleryHasPassword({ isPublic: false, hasStoredPassword: true, password: null })).toBe(false);
    expect(privateGalleryHasPassword({ isPublic: false, hasStoredPassword: true, password: '' })).toBe(false);
  });

  it('allows a private gallery when a new password is supplied', () => {
    expect(
      privateGalleryHasPassword({ isPublic: false, hasStoredPassword: false, password: 'hunter22' })
    ).toBe(true);
  });
});
