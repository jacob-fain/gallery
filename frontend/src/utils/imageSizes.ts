import type { Photo } from '../types';

// Mirrors IMAGE_SIZES in backend/src/services/imageService.ts. The backend
// resizes with withoutEnlargement, so a derived size is never wider than the
// original: a 1500px original has a 1500px "web" file, not a 1920px one.
const THUMBNAIL_MAX_WIDTH = 600;
const WEB_MAX_WIDTH = 1920;

export interface ImageCandidate {
  src: string;
  width: number;
  height: number;
}

/**
 * The derived images of a photo at their real pixel sizes, smallest first,
 * without duplicates. Originals are never included: they can be tens of
 * megabytes and are only for downloads.
 */
export function derivedImages(
  photo: Pick<Photo, 'width' | 'height' | 'thumbnailUrl' | 'webUrl'>
): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  if (!photo.width || !photo.height) return candidates;
  const ratio = photo.height / photo.width;

  const add = (src: string | undefined, maxWidth: number) => {
    if (!src) return;
    const width = Math.min(maxWidth, photo.width);
    if (candidates.some((c) => c.width === width)) return;
    candidates.push({ src, width, height: Math.round(width * ratio) });
  };

  add(photo.thumbnailUrl, THUMBNAIL_MAX_WIDTH);
  add(photo.webUrl, WEB_MAX_WIDTH);
  return candidates;
}
