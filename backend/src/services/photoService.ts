import { PoolClient } from 'pg';
import { query, withTransaction } from '../config/db';
import { Photo, PhotoWithUrls, CreatePhotoInput, UpdatePhotoInput } from '../types';
import { getSignedUrl } from './s3Service';
import { photoDownloadName } from './downloadNames';

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
     LEFT JOIN galleries g ON p.gallery_id = g.id
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
     LEFT JOIN galleries g ON p.gallery_id = g.id
     WHERE p.featured_order IS NOT NULL
     ORDER BY p.featured_order ASC`
  );
  return result.rows;
};

/**
 * Arbitrary advisory lock key held by every change to the homepage order.
 * Each change reads the current order and writes a new one, so two admin tabs
 * changing it at once would otherwise interleave and leave gaps or duplicate
 * positions (#60).
 */
export const FEATURED_LOCK_KEY = 4_172_031;

/**
 * Runs fn in a transaction that holds the featured-order lock. Statements fn
 * runs start after the lock is granted, so under READ COMMITTED each one sees
 * every change committed by the holder before it.
 */
const withFeaturedLock = <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> =>
  withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [FEATURED_LOCK_KEY]);
    return fn(client);
  });

/**
 * Rewrites featured_order as 0..n-1 following the given ordering of the
 * featured rows, so every change leaves the homepage order dense and also
 * repairs any gap or duplicate left by older code. Rows already in place are
 * not rewritten.
 */
const renumberFeatured = (client: PoolClient, orderBy: string, params: unknown[] = []) =>
  client.query(
    `WITH ranked AS (
       SELECT p.id, ROW_NUMBER() OVER (ORDER BY ${orderBy}) - 1 AS pos
       FROM photos p
       WHERE p.featured_order IS NOT NULL
     )
     UPDATE photos p
     SET featured_order = ranked.pos, is_featured = true
     FROM ranked
     WHERE p.id = ranked.id
       AND (p.featured_order IS DISTINCT FROM ranked.pos OR p.is_featured IS DISTINCT FROM true)`,
    params
  );

/** Makes a photo the hero (featured_order 0), shifting the rest down one. */
export const setHeroPhoto = async (photoId: string): Promise<void> =>
  withFeaturedLock(async (client) => {
    const result = await client.query(
      `UPDATE photos SET featured_order = -1, is_featured = true
       WHERE id = $1 AND featured_order IS DISTINCT FROM 0`,
      [photoId]
    );
    if (result.rowCount === 0) return; // Already the hero, or no such photo.
    await renumberFeatured(client, 'p.featured_order, p.id');
  });

/** Adds a photo to the end of the homepage order. */
export const addToFeatured = async (photoId: string): Promise<void> =>
  withFeaturedLock(async (client) => {
    await client.query(
      `UPDATE photos
       SET featured_order = (SELECT COALESCE(MAX(featured_order), -1) + 1 FROM photos WHERE featured_order IS NOT NULL),
           is_featured = true
       WHERE id = $1 AND featured_order IS NULL`,
      [photoId]
    );
  });

/** Removes a photo from the homepage order, closing the gap it leaves. */
export const removeFromFeatured = async (photoId: string): Promise<void> =>
  withFeaturedLock(async (client) => {
    const result = await client.query(
      `UPDATE photos SET featured_order = NULL, is_featured = false
       WHERE id = $1 AND featured_order IS NOT NULL`,
      [photoId]
    );
    if (result.rowCount === 0) return; // Not featured.
    await renumberFeatured(client, 'p.featured_order, p.id');
  });

/**
 * Puts the featured photos in the given order. Ids that are not featured are
 * ignored, and featured photos missing from the list (one featured from
 * another tab since this list was loaded) keep their relative order after
 * the listed ones, so no position is ever shared.
 */
export const reorderFeaturedPhotos = async (photoIds: string[]): Promise<void> =>
  withFeaturedLock(async (client) => {
    await renumberFeatured(
      client,
      `(SELECT MIN(t.n) FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, n) WHERE t.id = p.id) NULLS LAST,
       p.featured_order, p.id`,
      [photoIds]
    );
  });

/**
 * Signed URL for the full-size original, served as an attachment under the
 * photo's uploaded filename.
 */
export const getDownloadUrl = (photo: Photo): Promise<string> =>
  getSignedUrl(photo.s3_key, undefined, photoDownloadName(photo));

/**
 * Enrich a photo with signed S3 URLs
 * Converts raw S3 keys into temporary accessible URLs
 */
export const enrichPhotoWithUrls = async (photo: Photo): Promise<PhotoWithUrls> => {
  const [url, webUrl, thumbnailUrl] = await Promise.all([
    getDownloadUrl(photo),
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
 * Lock the target gallery's row so concurrent uploads and moves into it take
 * turns computing the next sort_order, and return that next position.
 * Unassigned photos list by upload time, so a null gallery needs no lock.
 */
const nextSortOrder = async (client: PoolClient, galleryId: string | null): Promise<number> => {
  if (galleryId) {
    await client.query(`SELECT 1 FROM galleries WHERE id = $1 FOR UPDATE`, [galleryId]);
  }
  const result = await client.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM photos
     WHERE gallery_id IS NOT DISTINCT FROM $1`,
    [galleryId]
  );
  return result.rows[0].next;
};

/**
 * Create a new photo record in the database, placed after every photo
 * already in its gallery (#83)
 * @param data - Photo creation input
 * @returns Created photo record
 */
export const createPhoto = async (data: CreatePhotoInput): Promise<Photo> =>
  withTransaction(async (client) => {
    const sortOrder = await nextSortOrder(client, data.gallery_id);
    const result = await client.query(
      `INSERT INTO photos (
        gallery_id, filename, original_filename,
        s3_key, s3_thumbnail_key, s3_web_key,
        width, height, file_size, exif_data, content_hash, sort_order, is_hidden,
        original_content_type
      )
      -- New uploads start hidden so nothing is public before it is reviewed;
      -- the admin publishes them with Show.
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13)
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
        data.content_hash || null,
        sortOrder,
        data.original_content_type ?? null,
      ]
    );
    return result.rows[0];
  });

// Name of the unique index from migration 012_unique_content_hash.sql.
const CONTENT_HASH_INDEX = 'photos_content_hash_key';

/**
 * True when an insert failed because another photo already has this content
 * hash: the database's answer to two identical uploads racing past the
 * duplicate check (#57).
 */
export const isDuplicateContentError = (err: unknown): boolean => {
  const pgErr = err as { code?: string; constraint?: string } | null;
  return pgErr?.code === '23505' && pgErr.constraint === CONTENT_HASH_INDEX;
};

/**
 * Find a photo by the SHA-256 hash of its original file
 */
export const getPhotoByContentHash = async (hash: string): Promise<Photo | null> => {
  const result = await query(
    `SELECT * FROM photos WHERE content_hash = $1 LIMIT 1`,
    [hash]
  );
  return result.rows[0] || null;
};

/**
 * Find which of the given content hashes are already uploaded
 * Returns one row per matched hash with the photo and its gallery title
 */
export const getPhotosByContentHashes = async (
  hashes: string[]
): Promise<(Photo & { gallery_title: string | null })[]> => {
  const result = await query(
    `SELECT DISTINCT ON (p.content_hash) p.*, g.title as gallery_title
     FROM photos p
     LEFT JOIN galleries g ON p.gallery_id = g.id
     WHERE p.content_hash = ANY($1)
     ORDER BY p.content_hash, p.uploaded_at ASC`,
    [hashes]
  );
  return result.rows;
};

/**
 * Get every publicly visible photo (public galleries and unassigned photos)
 * @param limit - Optional cap on the number of photos returned
 */
export const getAllPublicPhotos = async (limit?: number): Promise<Photo[]> => {
  const result = await query(
    `SELECT p.* FROM photos p
     LEFT JOIN galleries g ON p.gallery_id = g.id
     WHERE p.is_hidden = false AND (g.is_public = true OR p.gallery_id IS NULL)
     ORDER BY p.uploaded_at DESC
     ${limit ? 'LIMIT $1' : ''}`,
    limit ? [limit] : []
  );
  return result.rows;
};

/**
 * Get all photos not assigned to any gallery (admin)
 */
export const getUnassignedPhotos = async (): Promise<Photo[]> => {
  const result = await query(
    `SELECT * FROM photos
     WHERE gallery_id IS NULL
     ORDER BY uploaded_at DESC`
  );
  return result.rows;
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
 * Reorder photos in a gallery in one statement, so a failure leaves the old
 * order intact and two concurrent reorders cannot interleave row by row.
 * Ids not in the gallery are ignored; a repeated id takes its first position.
 * @param galleryId - Gallery the photos must belong to
 * @param photoIds - Array of photo IDs in desired order
 */
export const reorderPhotos = async (
  galleryId: string,
  photoIds: string[]
): Promise<void> => {
  await query(
    `UPDATE photos p
     SET sort_order = t.pos
     FROM (
       SELECT id, MIN(n) - 1 AS pos FROM unnest($2::uuid[]) WITH ORDINALITY AS u(id, n) GROUP BY id
     ) t
     WHERE p.id = t.id AND p.gallery_id = $1`,
    [galleryId, photoIds]
  );
};

/**
 * Move photos to another gallery, or to Unassigned when targetGalleryId is
 * null. Moved photos keep their relative order and go after the photos
 * already in the target. Only the database changes: S3 keys are stored per
 * row and never derived from the gallery, so the objects stay where they
 * are (#72).
 * @returns Number of photos moved (ids already in the target are skipped)
 */
export const movePhotos = async (
  photoIds: string[],
  targetGalleryId: string | null
): Promise<number> =>
  withTransaction(async (client) => {
    const base = await nextSortOrder(client, targetGalleryId);
    const moved = await client.query(
      `WITH picked AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, uploaded_at, id) - 1 AS n
         FROM photos
         WHERE id = ANY($2) AND gallery_id IS DISTINCT FROM $1
       )
       UPDATE photos p
       SET gallery_id = $1, sort_order = $3 + picked.n
       FROM picked
       WHERE p.id = picked.id
       RETURNING p.id`,
      [targetGalleryId, photoIds, base]
    );
    const movedIds = moved.rows.map((r) => r.id);
    if (movedIds.length > 0) {
      // A gallery's cover must be one of its own photos.
      await client.query(
        `UPDATE galleries SET cover_image_id = NULL WHERE cover_image_id = ANY($1)`,
        [movedIds]
      );
    }
    return movedIds.length;
  });
