import type { ExifData, Photo } from '../types';
import { getSignedUrl } from './s3Service';

/** A photo row, with the gallery columns the featured and All Photos queries join in. */
export type PhotoRow = Photo & { gallery_title?: string | null; gallery_slug?: string | null };

/**
 * A photo as visitors receive it. Only what the public pages render: never S3
 * keys, content_hash, filenames, counters, ordering, or visibility flags.
 * The original is not signed here; downloads get it from
 * GET /api/photos/:id/download.
 */
export interface PublicPhoto {
  id: string;
  gallery_id: string | null;
  width: number;
  height: number;
  exif_data: ExifData | null;
  webUrl: string;
  thumbnailUrl: string;
  gallery_title?: string | null;
  gallery_slug?: string | null;
}

export const publicPhoto = (
  photo: PhotoRow,
  urls: { webUrl: string; thumbnailUrl: string }
): PublicPhoto => ({
  id: photo.id,
  gallery_id: photo.gallery_id,
  width: photo.width,
  height: photo.height,
  exif_data: photo.exif_data ?? null,
  webUrl: urls.webUrl,
  thumbnailUrl: urls.thumbnailUrl,
  ...(photo.gallery_title !== undefined && {
    gallery_title: photo.gallery_title,
    gallery_slug: photo.gallery_slug ?? null,
  }),
});

export const toPublicPhoto = async (photo: PhotoRow): Promise<PublicPhoto> => {
  const [webUrl, thumbnailUrl] = await Promise.all([
    getSignedUrl(photo.s3_web_key),
    getSignedUrl(photo.s3_thumbnail_key),
  ]);
  return publicPhoto(photo, { webUrl, thumbnailUrl });
};

export const toPublicPhotos = (photos: PhotoRow[]): Promise<PublicPhoto[]> =>
  Promise.all(photos.map(toPublicPhoto));
