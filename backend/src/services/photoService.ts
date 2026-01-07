import { query } from '../config/db';
import { Photo, PhotoWithUrls } from '../types';
import { getSignedUrl } from './s3Service';

export const getPhotoById = async (id: string): Promise<Photo | null> => {
  const result = await query(
    `SELECT * FROM photos WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

export const getFeaturedPhotos = async (): Promise<Photo[]> => {
  const result = await query(
    `SELECT p.*, g.title as gallery_title, g.slug as gallery_slug
     FROM photos p
     JOIN galleries g ON p.gallery_id = g.id
     WHERE p.is_featured = true AND g.is_public = true
     ORDER BY p.uploaded_at DESC`
  );
  return result.rows;
};

export const incrementPhotoViews = async (photoId: string): Promise<void> => {
  await query(
    `UPDATE photos SET view_count = view_count + 1 WHERE id = $1`,
    [photoId]
  );
};

export const incrementPhotoDownloads = async (photoId: string): Promise<void> => {
  await query(
    `UPDATE photos SET download_count = download_count + 1 WHERE id = $1`,
    [photoId]
  );
};

/**
 * Enrich a photo with signed S3 URLs
 * Converts raw S3 keys into temporary accessible URLs
 */
export const enrichPhotoWithUrls = async (photo: Photo): Promise<PhotoWithUrls> => {
  const [url, webUrl, thumbnailUrl] = await Promise.all([
    getSignedUrl(photo.s3_key),
    getSignedUrl(photo.s3_web_key),
    getSignedUrl(photo.s3_thumbnail_key),
  ]);

  return {
    ...photo,
    url,
    webUrl,
    thumbnailUrl,
  };
};

/**
 * Enrich multiple photos with signed URLs
 * Uses Promise.all for parallel URL generation
 */
export const enrichPhotosWithUrls = async (photos: Photo[]): Promise<PhotoWithUrls[]> => {
  return Promise.all(photos.map(enrichPhotoWithUrls));
};
