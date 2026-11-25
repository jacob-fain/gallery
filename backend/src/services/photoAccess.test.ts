import { describe, expect, it } from 'vitest';
import { canViewPhoto } from './photoAccess';
import { generateGalleryAccessToken, generateToken } from './authService';

const privateGallery = { id: 'g-private', is_public: false, access_version: 0 };
const publicGallery = { id: 'g-public', is_public: true, access_version: 0 };
type Status = 'review' | 'shown' | 'rejected';
const photo = (over: Partial<{ review_status: Status; gallery_id: string | null; featured_order: number | null }> = {}) => ({
  review_status: 'shown' as Status,
  gallery_id: 'g-private',
  featured_order: null,
  ...over,
});

describe('canViewPhoto', () => {
  it('shows unassigned and public-gallery photos to anyone', () => {
    expect(canViewPhoto(photo({ gallery_id: null }), null)).toBe(true);
    expect(canViewPhoto(photo({ gallery_id: 'g-public' }), publicGallery)).toBe(true);
  });

  it.each(['review', 'rejected'] as const)('never shows a %s photo, even with a valid unlock token or on the homepage', (status) => {
    const token = generateGalleryAccessToken('g-private', 'private', 0);
    expect(canViewPhoto(photo({ review_status: status }), privateGallery, token)).toBe(false);
    expect(canViewPhoto(photo({ review_status: status, gallery_id: null }), null)).toBe(false);
    expect(canViewPhoto(photo({ review_status: status, gallery_id: 'g-public' }), publicGallery)).toBe(false);
    expect(canViewPhoto(photo({ review_status: status, featured_order: 0 }), privateGallery)).toBe(false);
  });

  it('refuses a private-gallery photo without a token', () => {
    expect(canViewPhoto(photo(), privateGallery)).toBe(false);
    expect(canViewPhoto(photo(), privateGallery, undefined)).toBe(false);
    expect(canViewPhoto(photo(), privateGallery, ['not', 'a', 'string'])).toBe(false);
  });

  it('shows a private-gallery photo with that gallery\'s unlock token', () => {
    const token = generateGalleryAccessToken('g-private', 'private', 0);
    expect(canViewPhoto(photo(), privateGallery, token)).toBe(true);
  });

  it('refuses an unlock token for a different gallery', () => {
    const other = generateGalleryAccessToken('g-other', 'other', 0);
    expect(canViewPhoto(photo(), privateGallery, other)).toBe(false);
  });

  it('refuses an admin token as an unlock token', () => {
    expect(canViewPhoto(photo(), privateGallery, generateToken('u1', 'a@example.com', 0))).toBe(false);
  });

  it('shows a homepage photo from a private gallery, as the homepage does', () => {
    expect(canViewPhoto(photo({ featured_order: 0 }), privateGallery)).toBe(true);
    expect(canViewPhoto(photo({ featured_order: 3 }), privateGallery)).toBe(true);
  });
});
