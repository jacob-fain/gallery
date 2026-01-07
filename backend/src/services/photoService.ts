import { query } from '../config/db';
import { Photo, PhotoWithUrls, CreatePhotoInput, UpdatePhotoInput } from '../types';
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

/**
 * Create a new photo record in the database
 * @param data - Photo creation input
 * @returns Created photo record
 */
export const createPhoto = async (data: CreatePhotoInput): Promise<Photo> => {
  const result = await query(
    `INSERT INTO photos (
      gallery_id, filename, original_filename,
      s3_key, s3_thumbnail_key, s3_web_key,
      width, height, file_size
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      data.gallery_id,
      data.filename,
      data.original_filename,
      data.s3_key,
      data.s3_thumbnail_key,
      data.s3_web_key,
      data.width,
      data.height,
      data.file_size,
    ]
  );
  return result.rows[0];
};

/**
 * Get all photos in a gallery ordered by sort_order
 */
export const getPhotosByGalleryId = async (galleryId: string): Promise<Photo[]> => {
  const result = await query(
    `SELECT * FROM photos
     WHERE gallery_id = $1
     ORDER BY sort_order ASC, uploaded_at ASC`,
    [galleryId]
  );
  return result.rows;
};

/**
 * Update a photo's metadata
 */
export const updatePhoto = async (
  id: string,
  data: UpdatePhotoInput
): Promise<Photo | null> => {
  // Column names are from a fixed set of if conditions, not user input - safe from SQL injection
  const updates: string[] = [];
  const values: (boolean | number | string)[] = [];
  let paramIndex = 1;

  if (data.is_featured !== undefined) {
    updates.push(`is_featured = $${paramIndex++}`);
    values.push(data.is_featured);
  }
  if (data.sort_order !== undefined) {
    updates.push(`sort_order = $${paramIndex++}`);
    values.push(data.sort_order);
  }

  if (updates.length === 0) {
    return getPhotoById(id);
  }

  values.push(id);
  const result = await query(
    `UPDATE photos SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  return result.rows[0] || null;
};

/**
 * Delete a photo from the database
 * Note: S3 files must be deleted separately before calling this
 * Returns the gallery_id for S3 cleanup
 */
export const deletePhoto = async (id: string): Promise<{ galleryId: string } | null> => {
  const result = await query(
    `DELETE FROM photos WHERE id = $1 RETURNING gallery_id`,
    [id]
  );
  if (result.rows[0]) {
    return { galleryId: result.rows[0].gallery_id };
  }
  return null;
};

/**
 * Reorder photos in a gallery
 * @param galleryId - Gallery ID to verify ownership
 * @param photoIds - Array of photo IDs in desired order
 */
export const reorderPhotos = async (
  galleryId: string,
  photoIds: string[]
): Promise<void> => {
  // Update each photo's sort_order based on its position in the array
  const updates = photoIds.map((photoId, index) =>
    query(
      `UPDATE photos SET sort_order = $1 WHERE id = $2 AND gallery_id = $3`,
      [index, photoId, galleryId]
    )
  );
  await Promise.all(updates);
};
