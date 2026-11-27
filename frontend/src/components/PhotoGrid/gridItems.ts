import type { ExifData, PublicPhoto, ReviewStatus } from '../../types';
import { derivedImages, type ImageCandidate } from '../../utils/imageSizes';
import { photoAlt } from '../../utils/photoAlt';
import { STATUS_LABELS } from '../../utils/reviewStatus';

/**
 * A photo the grid can show. The admin's Review view adds each photo's
 * review state; the public pages never have one.
 */
export type GridPhoto = PublicPhoto & { review_status?: ReviewStatus };

export interface AlbumPhoto {
  key: string;
  src: string;
  srcSet: ImageCandidate[];
  width: number;
  height: number;
  alt: string;
  // Review view only: badged on the tile when it is not shown.
  status?: ReviewStatus;
  // Review view only: the gallery named on the tile (All Photos).
  galleryLabel?: string;
}

export interface SlideWithExif {
  src: string;
  srcSet: ImageCandidate[];
  width: number;
  height: number;
  alt: string;
  photoId: string;
  // The original's size, which the viewer swaps in when zoomed in deep
  // (originalZoom.ts). Unset when it is no larger than the web size.
  originalWidth?: number;
  originalHeight?: number;
  exif?: ExifData;
  // Named in the viewer's label. Unset for a photo in no gallery.
  galleryName?: string;
  // Review view only: named in the viewer's label, and picks its actions.
  status?: ReviewStatus;
}

function fallbackUrl(photo: PublicPhoto): string {
  return photo.webUrl || photo.thumbnailUrl || '';
}

function altFor(photo: PublicPhoto, index: number, total: number, galleryTitle?: string) {
  return photoAlt(index, total, galleryTitle ?? photo.gallery_title);
}

export function toAlbumPhotos(
  photos: GridPhoto[],
  galleryTitle?: string,
  { galleryLabels = false }: { galleryLabels?: boolean } = {}
): AlbumPhoto[] {
  return photos.map((photo, index) => {
    const candidates = derivedImages(photo);
    const largest = candidates[candidates.length - 1];
    // The album appends { src, width } to the srcset whenever no candidate
    // matches width, which would advertise the thumbnail at the largest size.
    // Passing the largest real candidate's size keeps the srcset truthful.
    return {
      // Keyed by photo, not src: a refresh after URLs expire swaps every src,
      // and src keys would remount every tile.
      key: photo.id,
      src: candidates[0]?.src ?? fallbackUrl(photo),
      srcSet: candidates,
      width: largest?.width ?? photo.width,
      height: largest?.height ?? photo.height,
      alt: altFor(photo, index, photos.length, galleryTitle),
      ...(photo.review_status && { status: photo.review_status }),
      ...(galleryLabels && { galleryLabel: galleryTitle ?? photo.gallery_title ?? undefined }),
    };
  });
}

export function toLightboxSlides(photos: GridPhoto[], galleryTitle?: string): SlideWithExif[] {
  return photos.map((photo, index) => {
    const candidates = derivedImages(photo);
    const largest = candidates[candidates.length - 1];
    return {
      // The web size, not the original: originals can be tens of megabytes
      // and are fetched only for a deep zoom (originalZoom.ts) or a download.
      src: largest?.src ?? fallbackUrl(photo),
      srcSet: candidates,
      width: largest?.width ?? photo.width,
      height: largest?.height ?? photo.height,
      alt: altFor(photo, index, photos.length, galleryTitle),
      photoId: photo.id,
      ...(largest && photo.width > largest.width && { originalWidth: photo.width, originalHeight: photo.height }),
      exif: photo.exif_data ?? undefined,
      galleryName: galleryTitle ?? photo.gallery_title ?? undefined,
      ...(photo.review_status && { status: photo.review_status }),
    };
  });
}

// "Smith Wedding · 12 / 84", or "12 / 84" for a photo in no gallery. The
// Review view adds the photo's state: "Smith Wedding · 12 / 84 · Shown".
export function viewerLabel(slide: SlideWithExif | undefined, index: number, total: number): string {
  const position = `${index + 1} / ${total}`;
  const label = slide?.galleryName ? `${slide.galleryName} · ${position}` : position;
  return slide?.status ? `${label} · ${STATUS_LABELS[slide.status]}` : label;
}

export function gridColumns(containerWidth: number): number {
  if (containerWidth < 500) return 1;
  if (containerWidth < 900) return 2;
  return 3;
}

// The album's width is the viewport less .grid's side padding
// (PhotoGrid.module.css). The album divides this per column itself.
export const GRID_SIZES = {
  size: 'calc(100vw - 96px)',
  sizes: [{ viewport: '(max-width: 640px)', size: 'calc(100vw - 48px)' }],
};

// The tile's width as CSS sees it (SingleTiles.module.css): the grid's
// content width, or less for a photo whose height would pass the viewport's
// less the navbar. The same sum serves as the image's sizes, so the browser
// picks a file at least as wide as the tile in device pixels. The gutters
// are .grid's (PhotoGrid.module.css).
export function singleTileSizes(ratio: number): string {
  const tall = `calc((100vh - 64px) * ${ratio.toFixed(4)})`;
  return `(max-width: 640px) min(calc(100vw - 48px), ${tall}), min(calc(100vw - 96px), ${tall})`;
}
