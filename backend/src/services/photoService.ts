import { query } from '../config/db';
import { Photo, PhotoWithUrls, CreatePhotoInput, UpdatePhotoInput } from '../types';
import { getSignedUrl, copyFile, deleteFile, generatePhotoKeys } from './s3Service';

export const getPhotoById = async (id: string): Promise<Photo | null> => {
  const result = await query(
    `SELECT * FROM photos WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

export const getFeaturedPhotos = async (): Promise<Photo[]> => {
  // Featured photos show on homepage regardless of gallery visibility
  // (user explicitly selected them for homepage)
  // Only filter by is_hidden to respect photo-level visibility
  const result = await query(
    `SELECT p.*, g.title as gallery_title, g.slug as gallery_slug
     FROM photos p
     JOIN galleries g ON p.gallery_id = g.id
     WHERE p.featured_order IS NOT NULL AND p.is_hidden = false
     ORDER BY p.featured_order ASC`
  );
  return result.rows;
};

// Get all featured photos for admin (includes hidden, any gallery)
export const getFeaturedPhotosAdmin = async (): Promise<Photo[]> => {
  const result = await query(
    `SELECT p.*, g.title as gallery_title, g.slug as gallery_slug
     FROM photos p
     JOIN galleries g ON p.gallery_id = g.id
     WHERE p.featured_order IS NOT NULL
     ORDER BY p.featured_order ASC`
  );
  return result.rows;
};

// Set a photo as the hero (featured_order = 0)
export const setHeroPhoto = async (photoId: string): Promise<void> => {
  // Check if photo is already featured
  const existing = await query(
    `SELECT featured_order FROM photos WHERE id = $1`,
    [photoId]
  );
  const currentOrder = existing.rows[0]?.featured_order;

  if (currentOrder === 0) {
    // Already the hero, nothing to do
    return;
  }

  if (currentOrder !== null) {
    // Photo is featured but not hero - remove from current position first
    await query(
      `UPDATE photos SET featured_order = featured_order - 1
       WHERE featured_order > $1 AND featured_order IS NOT NULL`,
      [currentOrder]
    );
  }

  // Shift all existing featured photos down by 1
  await query(
    `UPDATE photos SET featured_order = featured_order + 1 WHERE featured_order IS NOT NULL`
  );

  // Set the new hero
  await query(
    `UPDATE photos SET featured_order = 0, is_featured = true WHERE id = $1`,
    [photoId]
  );
};

// Add a photo to featured (at the end)
export const addToFeatured = async (photoId: string): Promise<void> => {
  // Check if already featured
  const existing = await query(
    `SELECT featured_order FROM photos WHERE id = $1`,
    [photoId]
  );
  if (existing.rows[0]?.featured_order !== null) {
    return; // Already featured
  }

  const result = await query(
    `SELECT COALESCE(MAX(featured_order), -1) + 1 as next_order FROM photos WHERE featured_order IS NOT NULL`
  );
  const nextOrder = result.rows[0].next_order;
  await query(
    `UPDATE photos SET featured_order = $1, is_featured = true WHERE id = $2`,
    [nextOrder, photoId]
  );
};

// Remove a photo from featured
export const removeFromFeatured = async (photoId: string): Promise<void> => {
  // Get current order before removing
  const result = await query(
    `SELECT featured_order FROM photos WHERE id = $1`,
    [photoId]
  );
  const currentOrder = result.rows[0]?.featured_order;

  if (currentOrder === null) {
    return; // Not featured
  }

  // Remove from featured
  await query(
    `UPDATE photos SET featured_order = NULL, is_featured = false WHERE id = $1`,
    [photoId]
  );

  // Shift remaining photos up
  await query(
    `UPDATE photos SET featured_order = featured_order - 1 WHERE featured_order > $1`,
    [currentOrder]
  );
};

// Reorder featured photos
export const reorderFeaturedPhotos = async (photoIds: string[]): Promise<void> => {
  // Update each photo with its new order
  for (let i = 0; i < photoIds.length; i++) {
    await query(
      `UPDATE photos SET featured_order = $1 WHERE id = $2 AND featured_order IS NOT NULL`,
      [i, photoIds[i]]
    );
  }
};

export const incrementPhotoViews = async (photoId: string): Promise<void> => {
  // Get gallery_id for analytics and increment counter in parallel
  const [photoResult] = await Promise.all([
    query(`SELECT gallery_id FROM photos WHERE id = $1`, [photoId]),
    query(`UPDATE photos SET view_count = view_count + 1 WHERE id = $1`, [photoId]),
  ]);

  // Log analytics event with both photo and gallery IDs
  if (photoResult.rows[0]) {
    await query(
      `INSERT INTO analytics_events (event_type, gallery_id, photo_id) VALUES ('photo_view', $1, $2)`,
      [photoResult.rows[0].gallery_id, photoId]
    );
  }
};

export const incrementPhotoDownloads = async (photoId: string): Promise<void> => {
  // Get gallery_id for analytics and increment counter in parallel
  const [photoResult] = await Promise.all([
    query(`SELECT gallery_id FROM photos WHERE id = $1`, [photoId]),
    query(`UPDATE photos SET download_count = download_count + 1 WHERE id = $1`, [photoId]),
  ]);

  // Log analytics event with both photo and gallery IDs
  if (photoResult.rows[0]) {
    await query(
      `INSERT INTO analytics_events (event_type, gallery_id, photo_id) VALUES ('photo_download', $1, $2)`,
      [photoResult.rows[0].gallery_id, photoId]
    );
  }
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
      width, height, file_size, exif_data
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      data.exif_data ? JSON.stringify(data.exif_data) : null,
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
  if (data.is_hidden !== undefined) {
    updates.push(`is_hidden = $${paramIndex++}`);
    values.push(data.is_hidden);
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

/**
 * Move photos to a different gallery
 * Copies S3 files to new paths and updates database
 * @param photoIds - Array of photo IDs to move
 * @param targetGalleryId - Destination gallery ID
 * @returns Number of photos moved
 */
export const movePhotos = async (
  photoIds: string[],
  targetGalleryId: string
): Promise<number> => {
  let movedCount = 0;

  for (const photoId of photoIds) {
    const photo = await getPhotoById(photoId);
    if (!photo) continue;

    // Skip if already in target gallery
    if (photo.gallery_id === targetGalleryId) continue;

    const sourceGalleryId = photo.gallery_id;

    // Generate new S3 keys for target gallery
    const newKeys = generatePhotoKeys(targetGalleryId, photoId);

    try {
      // Copy all 3 versions to new paths
      await Promise.all([
        copyFile(photo.s3_key, newKeys.original),
        copyFile(photo.s3_web_key, newKeys.web),
        copyFile(photo.s3_thumbnail_key, newKeys.thumbnail),
      ]);

      // Update database with new gallery and S3 keys
      await query(
        `UPDATE photos
         SET gallery_id = $1, s3_key = $2, s3_web_key = $3, s3_thumbnail_key = $4, sort_order = 9999
         WHERE id = $5`,
        [targetGalleryId, newKeys.original, newKeys.web, newKeys.thumbnail, photoId]
      );

      // Delete old S3 files
      await Promise.allSettled([
        deleteFile(photo.s3_key),
        deleteFile(photo.s3_web_key),
        deleteFile(photo.s3_thumbnail_key),
      ]);

      // If this photo was the cover of source gallery, clear it
      await query(
        `UPDATE galleries SET cover_image_id = NULL WHERE id = $1 AND cover_image_id = $2`,
        [sourceGalleryId, photoId]
      );

      movedCount++;
    } catch (err) {
      console.error(`Failed to move photo ${photoId}:`, err);
      // Continue with other photos
    }
  }

  return movedCount;
};
