import { PoolClient } from 'pg';
import { query, withTransaction } from '../config/db';
import { Photo, PhotoWithUrls, CreatePhotoInput, UpdatePhotoInput } from '../types';
import { getSignedUrl } from './s3Service';
import { photoDownloadName } from './downloadNames';
import type { PublicCursor } from './photoPaging';
import type { PhotoRow } from './photoView';

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

// Postgres keeps microseconds, which a JavaScript Date would drop, so the
// cursor's timestamp is formatted by the database.
const CURSOR_TIME = `to_char(p.uploaded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * One page of the publicly visible photos (public galleries and unassigned),
 * newest first, starting after the given cursor. next is the cursor of the
 * following page, or null when this page is the last.
 */
export const getPublicPhotosPage = async (
  limit: number,
  after: PublicCursor | null = null
): Promise<{ photos: PhotoRow[]; next: PublicCursor | null }> => {
  // One extra row says whether another page follows, without a count. The
  // gallery title names each photo's gallery in the All Photos viewer.
  const result = await query(
    `SELECT p.*, g.title AS gallery_title, g.slug AS gallery_slug, ${CURSOR_TIME} AS cursor_uploaded_at
     FROM photos p
     LEFT JOIN galleries g ON p.gallery_id = g.id
     WHERE p.is_hidden = false AND (g.is_public = true OR p.gallery_id IS NULL)
       AND ($2::timestamptz IS NULL OR (p.uploaded_at, p.id) < ($2::timestamptz, $3::uuid))
     ORDER BY p.uploaded_at DESC, p.id DESC
     LIMIT $1`,
    [limit + 1, after?.uploadedAt ?? null, after?.id ?? null]
  );
  const rows = result.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    photos: rows.map(({ cursor_uploaded_at: _cursor, ...photo }) => photo as PhotoRow),
    next: result.rows.length > limit ? { uploadedAt: last.cursor_uploaded_at, id: last.id } : null,
  };
};

/** A page of an admin photo list, and the length of the whole list. */
export interface PhotoPage {
  photos: Photo[];
  total: number;
}

export type OffsetPage = { limit: number; offset: number } | null;

const offsetPage = async (
  where: string,
  orderBy: string,
  params: unknown[],
  page: OffsetPage
): Promise<PhotoPage> => {
  if (!page) {
    const all = await query(`SELECT * FROM photos WHERE ${where} ORDER BY ${orderBy}`, params);
    return { photos: all.rows, total: all.rows.length };
  }
  const n = params.length;
  const [rows, count] = await Promise.all([
    query(
      `SELECT * FROM photos WHERE ${where} ORDER BY ${orderBy} LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...params, page.limit, page.offset]
    ),
    query(`SELECT COUNT(*)::int AS total FROM photos WHERE ${where}`, params),
  ]);
  return { photos: rows.rows, total: count.rows[0].total };
};

/**
 * Photos not assigned to any gallery (admin), newest first: one page, or
 * all of them when page is null.
 */
export const getUnassignedPhotos = (page: OffsetPage = null): Promise<PhotoPage> =>
  offsetPage('gallery_id IS NULL', 'uploaded_at DESC, id DESC', [], page);

/**
 * A gallery's photos, hidden ones included (admin), in gallery order: one
 * page, or all of them when page is null. The id tiebreak keeps pages from
 * overlapping when two photos share a position.
 */
export const getGalleryPhotosAdmin = (galleryId: string, page: OffsetPage = null): Promise<PhotoPage> =>
  offsetPage('gallery_id = $1', 'sort_order ASC, uploaded_at ASC, id ASC', [galleryId], page);

/**
 * Get all photos in a gallery ordered by sort_order
 */
export const getPhotosByGalleryId = async (galleryId: string): Promise<Photo[]> =>
  (await getGalleryPhotosAdmin(galleryId)).photos;

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
 * Put a gallery's photos in the given order and renumber the gallery 0..n-1.
 * The gallery's photos missing from the list keep their relative order after
 * the listed ones, so the admin can reorder the pages it has loaded without
 * sending the rest. Ids not in the gallery are ignored; a repeated id takes
 * its first position.
 * @param galleryId - Gallery the photos must belong to
 * @param photoIds - Photo IDs in the desired order
 */
export const reorderPhotos = async (galleryId: string, photoIds: string[]): Promise<void> =>
  withTransaction(async (client) => {
    // The lock uploads and moves take before picking a position, so none of
    // them reads positions this reorder is rewriting, and two reorders apply
    // one after the other.
    await client.query(`SELECT 1 FROM galleries WHERE id = $1 FOR UPDATE`, [galleryId]);
    await client.query(
      `WITH listed AS (
         SELECT id, MIN(n) AS n FROM unnest($2::uuid[]) WITH ORDINALITY AS u(id, n) GROUP BY id
       ), ranked AS (
         SELECT p.id,
                ROW_NUMBER() OVER (ORDER BY listed.n NULLS LAST, p.sort_order, p.uploaded_at, p.id) - 1 AS pos
         FROM photos p
         LEFT JOIN listed ON listed.id = p.id
         WHERE p.gallery_id = $1
       )
       UPDATE photos p
       SET sort_order = ranked.pos
       FROM ranked
       WHERE p.id = ranked.id AND p.sort_order IS DISTINCT FROM ranked.pos`,
      [galleryId, photoIds]
    );
  });

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
