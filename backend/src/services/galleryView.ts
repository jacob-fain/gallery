import type { Gallery, GalleryWithCoverUrl } from '../types';

/**
 * A gallery as visitors receive it. Only what the public pages render: never
 * the password hash or whether one exists, counters, ordering, the chosen
 * cover's id, or timestamps.
 */
export interface PublicGallery {
  id: string;
  title: string;
  slug: string;
}

/**
 * One gallery as its page receives it: the heading also shows the
 * description and how many photos a visitor sees. Never sent for a private
 * gallery before it is unlocked.
 */
export interface PublicGalleryDetail extends PublicGallery {
  description: string | null;
  photoCount: number;
}

/** A gallery on the public list, with the cover photo and photo count the card shows. */
export interface PublicGalleryCard extends PublicGallery {
  coverUrl: string | null;
  coverWebUrl: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  photoCount: number;
}

export const publicGallery = (gallery: Gallery): PublicGallery => ({
  id: gallery.id,
  title: gallery.title,
  slug: gallery.slug,
});

export const publicGalleryDetail = (gallery: Gallery, photoCount: number): PublicGalleryDetail => ({
  ...publicGallery(gallery),
  description: gallery.description ?? null,
  photoCount,
});

export const publicGalleryCard = (gallery: GalleryWithCoverUrl): PublicGalleryCard => ({
  ...publicGallery(gallery),
  coverUrl: gallery.coverUrl,
  coverWebUrl: gallery.coverWebUrl,
  coverWidth: gallery.coverWidth,
  coverHeight: gallery.coverHeight,
  photoCount: gallery.photoCount,
});

/**
 * A gallery as the admin receives it: the full row without the hash, plus
 * whether one is set, so the edit form knows a blank password field means
 * "keep the current one".
 */
export const adminGallery = <T extends Gallery>(gallery: T) => {
  const { password_hash: passwordHash, access_version: _accessVersion, ...row } = gallery;
  return { ...row, has_password: Boolean(passwordHash) };
};
