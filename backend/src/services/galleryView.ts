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

/** A gallery on the public list, with the cover photo the card shows. */
export interface PublicGalleryCard extends PublicGallery {
  coverUrl: string | null;
  coverWebUrl: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
}

export const publicGallery = (gallery: Gallery): PublicGallery => ({
  id: gallery.id,
  title: gallery.title,
  slug: gallery.slug,
});

export const publicGalleryCard = (gallery: GalleryWithCoverUrl): PublicGalleryCard => ({
  ...publicGallery(gallery),
  coverUrl: gallery.coverUrl,
  coverWebUrl: gallery.coverWebUrl,
  coverWidth: gallery.coverWidth,
  coverHeight: gallery.coverHeight,
});

/**
 * A gallery as the admin receives it: the full row without the hash, plus
 * whether one is set, so the edit form knows a blank password field means
 * "keep the current one".
 */
export const adminGallery = <T extends Gallery>(gallery: T) => {
  const { password_hash: passwordHash, ...row } = gallery;
  return { ...row, has_password: Boolean(passwordHash) };
};
