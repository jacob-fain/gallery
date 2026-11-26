import { getAllPhotos, getGallery, getGalleryPhotos, isKnownPrivateGallery } from '../api/client';
import { isGallerySlug } from '../utils/slug';

// Session storage key for a private gallery's access token.
export const galleryTokenKey = (slug: string) => `gallery_access_${slug}`;

function storedToken(slug: string): string | null {
  try {
    return sessionStorage.getItem(galleryTokenKey(slug));
  } catch {
    return null;
  }
}

/**
 * The grid pages' code loads on demand, and their first requests used to
 * wait for it. These start the same requests as the route matches, so they
 * run alongside the code. They use the same cache keys as the pages, which
 * join them while in flight or read their result after. Errors are left to
 * the pages, which make the same requests and handle them.
 */
export function startGalleryRequests(slug: string | undefined): void {
  if (!isGallerySlug(slug)) return;
  getGallery(slug).catch(() => {});
  const token = storedToken(slug);
  if (token) getGalleryPhotos(slug, token).catch(() => {});
  else if (!isKnownPrivateGallery(slug)) getGalleryPhotos(slug).catch(() => {});
}

export function startAllPhotosRequest(): void {
  getAllPhotos().catch(() => {});
}
