import type { PublicPhoto } from '../types';

/**
 * Whether a featured photo opens a run of photos from one gallery. Only the
 * first of a run is captioned: the rest would repeat the same name.
 */
export function startsGalleryRun(photos: PublicPhoto[], index: number): boolean {
  const slug = photos[index].gallery_slug;
  return Boolean(slug) && (index === 0 || photos[index - 1].gallery_slug !== slug);
}
