import type { Gallery, Photo } from '../types';
import { galleryAccessTokenUnlocks } from './authService';

/**
 * Whether a visitor may see a photo, and so be handed its signed URLs.
 *
 * Only shown photos are ever public. A shown photo is public when it is
 * unassigned, in a public gallery, or chosen for the homepage (featured
 * photos are shown publicly regardless of their gallery). A photo in a
 * private gallery otherwise needs that gallery's unlock token.
 */
export const canViewPhoto = (
  photo: Pick<Photo, 'review_status' | 'gallery_id' | 'featured_order'>,
  gallery: Pick<Gallery, 'id' | 'is_public' | 'access_version'> | null,
  accessToken?: unknown
): boolean => {
  if (photo.review_status !== 'shown') return false;
  if (!photo.gallery_id || !gallery) return true;
  if (gallery.is_public) return true;
  if (photo.featured_order !== null && photo.featured_order !== undefined) return true;
  return galleryAccessTokenUnlocks(accessToken, gallery);
};
