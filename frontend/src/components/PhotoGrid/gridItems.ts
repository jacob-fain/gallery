import type { ExifData, PublicPhoto } from '../../types';
import { derivedImages, type ImageCandidate } from '../../utils/imageSizes';
import { photoAlt } from '../../utils/photoAlt';

export interface AlbumPhoto {
  key: string;
  src: string;
  srcSet: ImageCandidate[];
  width: number;
  height: number;
  alt: string;
}

export interface SlideWithExif {
  src: string;
  srcSet: ImageCandidate[];
  width: number;
  height: number;
  alt: string;
  photoId: string;
  exif?: ExifData;
  // Named in the viewer's label. Unset for a photo in no gallery.
  galleryName?: string;
}

function fallbackUrl(photo: PublicPhoto): string {
  return photo.webUrl || photo.thumbnailUrl || '';
}

function altFor(photo: PublicPhoto, index: number, total: number, galleryTitle?: string) {
  return photoAlt(index, total, galleryTitle ?? photo.gallery_title);
}

export function toAlbumPhotos(photos: PublicPhoto[], galleryTitle?: string): AlbumPhoto[] {
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
    };
  });
}

export function toLightboxSlides(photos: PublicPhoto[], galleryTitle?: string): SlideWithExif[] {
  return photos.map((photo, index) => {
    const candidates = derivedImages(photo);
    const largest = candidates[candidates.length - 1];
    return {
      // The web size, not the original: originals can be tens of megabytes
      // and are fetched only by the download button.
      src: largest?.src ?? fallbackUrl(photo),
      srcSet: candidates,
      width: largest?.width ?? photo.width,
      height: largest?.height ?? photo.height,
      alt: altFor(photo, index, photos.length, galleryTitle),
      photoId: photo.id,
      exif: photo.exif_data ?? undefined,
      galleryName: galleryTitle ?? photo.gallery_title ?? undefined,
    };
  });
}

// "Smith Wedding · 12 / 84", or "12 / 84" for a photo in no gallery.
export function viewerLabel(slide: SlideWithExif | undefined, index: number, total: number): string {
  const position = `${index + 1} / ${total}`;
  return slide?.galleryName ? `${slide.galleryName} · ${position}` : position;
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
