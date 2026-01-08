import { query } from '../config/db';
import { Gallery, Photo, GalleryWithCoverUrl, CreateGalleryInput, UpdateGalleryInput } from '../types';
import { hashPassword, verifyPassword } from './authService';
import { getSignedUrl } from './s3Service';

export const getPublicGalleries = async (): Promise<Gallery[]> => {
  const result = await query(
    `SELECT * FROM galleries
     WHERE is_public = true
     ORDER BY created_at DESC`
  );
  return result.rows;
};

/**
 * Get public galleries with cover photo URLs
 * Uses explicit cover_image_id if set, otherwise falls back to first photo
 */
export const getPublicGalleriesWithCovers = async (): Promise<GalleryWithCoverUrl[]> => {
  // Get galleries with their cover photo's thumbnail key
  // If no cover_image_id is set, use the first photo (by sort_order) as fallback
  const result = await query(
    `SELECT g.*,
            COALESCE(cover.s3_thumbnail_key, first_photo.s3_thumbnail_key) as cover_thumbnail_key
     FROM galleries g
     LEFT JOIN photos cover ON g.cover_image_id = cover.id
     LEFT JOIN LATERAL (
       SELECT s3_thumbnail_key
       FROM photos
       WHERE gallery_id = g.id
       ORDER BY sort_order ASC, uploaded_at ASC
       LIMIT 1
     ) first_photo ON g.cover_image_id IS NULL
     WHERE g.is_public = true
     ORDER BY g.created_at DESC`
  );

  // Generate signed URLs for cover photos
  const galleriesWithUrls = await Promise.all(
    result.rows.map(async (row: Gallery & { cover_thumbnail_key: string | null }) => {
      const { cover_thumbnail_key, ...gallery } = row;
      return {
        ...gallery,
        coverUrl: cover_thumbnail_key ? await getSignedUrl(cover_thumbnail_key) : null,
      };
    })
  );

  return galleriesWithUrls;
};

export const getGalleryBySlug = async (slug: string): Promise<Gallery | null> => {
  const result = await query(
    `SELECT * FROM galleries WHERE slug = $1`,
    [slug]
  );
  return result.rows[0] || null;
};

export const getGalleryById = async (id: string): Promise<Gallery | null> => {
  const result = await query(
    `SELECT * FROM galleries WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

export const getGalleryPhotos = async (galleryId: string): Promise<Photo[]> => {
  const result = await query(
    `SELECT * FROM photos
     WHERE gallery_id = $1
     ORDER BY sort_order ASC, uploaded_at ASC`,
    [galleryId]
  );
  return result.rows;
};

export const incrementGalleryViews = async (galleryId: string): Promise<void> => {
  // Increment counter and log analytics event in parallel
  await Promise.all([
    query(
      `UPDATE galleries SET view_count = view_count + 1 WHERE id = $1`,
      [galleryId]
    ),
    query(
      `INSERT INTO analytics_events (event_type, gallery_id) VALUES ('gallery_view', $1)`,
      [galleryId]
    ),
  ]);
};

/**
 * Get all galleries (admin only - includes private)
 */
export const getAllGalleries = async (): Promise<Gallery[]> => {
  const result = await query(
    `SELECT * FROM galleries ORDER BY created_at DESC`
  );
  return result.rows;
};

/**
 * Create a new gallery
 */
export const createGallery = async (data: CreateGalleryInput): Promise<Gallery> => {
  const passwordHash = data.password ? await hashPassword(data.password) : null;

  const result = await query(
    `INSERT INTO galleries (title, slug, description, is_public, password_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      data.title,
      data.slug,
      data.description || null,
      data.is_public ?? true,
      passwordHash,
    ]
  );
  return result.rows[0];
};

/**
 * Update an existing gallery
 */
export const updateGallery = async (
  id: string,
  data: UpdateGalleryInput
): Promise<Gallery | null> => {
  // Build dynamic update query based on provided fields
  // Column names are from a fixed set of if conditions, not user input - safe from SQL injection
  const updates: string[] = [];
  const values: (string | boolean | null)[] = [];
  let paramIndex = 1;

  if (data.title !== undefined) {
    updates.push(`title = $${paramIndex++}`);
    values.push(data.title);
  }
  if (data.slug !== undefined) {
    updates.push(`slug = $${paramIndex++}`);
    values.push(data.slug);
  }
  if (data.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(data.description);
  }
  if (data.is_public !== undefined) {
    updates.push(`is_public = $${paramIndex++}`);
    values.push(data.is_public);
  }
  if (data.password !== undefined) {
    updates.push(`password_hash = $${paramIndex++}`);
    // null removes password, string sets new password
    values.push(data.password ? await hashPassword(data.password) : null);
  }

  if (updates.length === 0) {
    return getGalleryById(id);
  }

  values.push(id);
  const result = await query(
    `UPDATE galleries SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  return result.rows[0] || null;
};

/**
 * Delete a gallery (photos are cascade deleted by DB)
 * Note: S3 files must be deleted separately before calling this
 */
export const deleteGallery = async (id: string): Promise<boolean> => {
  const result = await query(
    `DELETE FROM galleries WHERE id = $1 RETURNING id`,
    [id]
  );
  return result.rowCount !== null && result.rowCount > 0;
};

/**
 * Set the cover image for a gallery
 */
export const setCoverImage = async (
  galleryId: string,
  photoId: string | null
): Promise<Gallery | null> => {
  const result = await query(
    `UPDATE galleries SET cover_image_id = $1 WHERE id = $2 RETURNING *`,
    [photoId, galleryId]
  );
  return result.rows[0] || null;
};

/**
 * Check if a slug is already taken (for validation)
 */
export const isSlugTaken = async (slug: string, excludeId?: string): Promise<boolean> => {
  const result = excludeId
    ? await query(
        `SELECT id FROM galleries WHERE slug = $1 AND id != $2`,
        [slug, excludeId]
      )
    : await query(`SELECT id FROM galleries WHERE slug = $1`, [slug]);
  return result.rows.length > 0;
};

/**
 * Verify a password for a private gallery
 * Returns true if password is correct, false otherwise
 */
export const verifyGalleryPassword = async (
  gallery: Gallery,
  password: string
): Promise<boolean> => {
  if (!gallery.password_hash) {
    return false; // No password set
  }
  return verifyPassword(password, gallery.password_hash);
};

/**
 * Get admin dashboard statistics
 */
export const getStats = async (): Promise<{
  galleries: { total: number; public: number; private: number };
  photos: { total: number; featured: number };
  views: { galleries: number; photos: number };
  downloads: number;
}> => {
  const [galleriesResult, photosResult, galleryViewsResult, photoStatsResult] = await Promise.all([
    query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_public = true) as public,
        COUNT(*) FILTER (WHERE is_public = false) as private
      FROM galleries
    `),
    query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_featured = true) as featured
      FROM photos
    `),
    query(`SELECT COALESCE(SUM(view_count), 0) as total FROM galleries`),
    query(`SELECT COALESCE(SUM(view_count), 0) as views, COALESCE(SUM(download_count), 0) as downloads FROM photos`),
  ]);

  return {
    galleries: {
      total: parseInt(galleriesResult.rows[0].total, 10),
      public: parseInt(galleriesResult.rows[0].public, 10),
      private: parseInt(galleriesResult.rows[0].private, 10),
    },
    photos: {
      total: parseInt(photosResult.rows[0].total, 10),
      featured: parseInt(photosResult.rows[0].featured, 10),
    },
    views: {
      galleries: parseInt(galleryViewsResult.rows[0].total, 10),
      photos: parseInt(photoStatsResult.rows[0].views, 10),
    },
    downloads: parseInt(photoStatsResult.rows[0].downloads, 10),
  };
};
