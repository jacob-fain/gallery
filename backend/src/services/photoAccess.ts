import type { Gallery, Photo } from '../types';
import { verifyGalleryAccessToken } from './authService';

/**
 * Whether a visitor may see a photo, and so be handed its signed URLs.
 *
 * Hidden photos are never public. A visible photo is public when it is
 * unassigned, in a public gallery, or chosen for the homepage (featured
 * photos are shown publicly regardless of their gallery). A photo in a
 * private gallery otherwise needs that gallery's unlock token.
 */
export const canViewPhoto = (
  photo: Pick<Photo, 'is_hidden' | 'gallery_id' | 'featured_order'>,
  gallery: Pick<Gallery, 'id' | 'is_public'> | null,
  accessToken?: unknown
): boolean => {
  if (photo.is_hidden) return false;
  if (!photo.gallery_id || !gallery) return true;
  if (gallery.is_public) return true;
  if (photo.featured_order !== null && photo.featured_order !== undefined) return true;
  if (typeof accessToken !== 'string') return false;
  return verifyGalleryAccessToken(accessToken)?.galleryId === gallery.id;
};
