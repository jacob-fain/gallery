import { query } from '../config/db';
import { Gallery, Photo, GalleryWithCoverUrl, CreateGalleryInput, UpdateGalleryInput } from '../types';
import { hashPassword, verifyPassword } from './authService';
import { getSignedUrl } from './s3Service';

/**
 * Whether a gallery would be reachable after a create or update: a private
 * gallery with no password can never be opened, because verification fails
 * when no hash is stored.
 *
 * password follows the update API: undefined keeps the stored password,
 * null or an empty string removes it, any other string replaces it.
 */
export const privateGalleryHasPassword = ({
  isPublic,
  hasStoredPassword,
  password,
}: {
  isPublic: boolean;
  hasStoredPassword: boolean;
  password: string | null | undefined;
}): boolean => {
  if (isPublic) return true;
  if (password === undefined) return hasStoredPassword;
  return typeof password === 'string' && password.length > 0;
};

export const getPublicGalleries = async (): Promise<Gallery[]> => {
  const result = await query(
    `SELECT * FROM galleries
     WHERE is_public = true
     ORDER BY sort_order ASC, created_at DESC`
  );
  return result.rows;
};

/**
 * Get public galleries with cover photo URLs
 * Uses explicit cover_image_id if set, otherwise falls back to first photo
 */
/**
 * Public galleries with the thumbnail key of the photo to show as each cover.
 * The chosen cover is used only while it is visible and still in the
 * gallery; otherwise the first visible photo stands in, so hiding a photo
 * always removes it from the public site.
 */
export interface GalleryCoverRow extends Gallery {
  cover_thumbnail_key: string | null;
  cover_web_key: string | null;
  cover_width: number | null;
  cover_height: number | null;
}

export const getPublicGalleryCoverKeys = async (): Promise<GalleryCoverRow[]> => {
  // Every cover field comes from the same photo: the chosen cover when it
  // qualifies, otherwise the first visible one.
  const result = await query(
    `SELECT g.*,
            CASE WHEN cover.id IS NOT NULL THEN cover.s3_thumbnail_key ELSE first_photo.s3_thumbnail_key END AS cover_thumbnail_key,
            CASE WHEN cover.id IS NOT NULL THEN cover.s3_web_key ELSE first_photo.s3_web_key END AS cover_web_key,
            CASE WHEN cover.id IS NOT NULL THEN cover.width ELSE first_photo.width END AS cover_width,
            CASE WHEN cover.id IS NOT NULL THEN cover.height ELSE first_photo.height END AS cover_height
     FROM galleries g
     LEFT JOIN photos cover
       ON cover.id = g.cover_image_id
      AND cover.gallery_id = g.id
      AND cover.is_hidden = false
     LEFT JOIN LATERAL (
       SELECT s3_thumbnail_key, s3_web_key, width, height
       FROM photos
       WHERE gallery_id = g.id AND is_hidden = false
       ORDER BY sort_order ASC, uploaded_at ASC
       LIMIT 1
     ) first_photo ON cover.id IS NULL
     WHERE g.is_public = true
     ORDER BY g.sort_order ASC, g.created_at DESC`
  );
  return result.rows;
};

export const getPublicGalleriesWithCovers = async (): Promise<GalleryWithCoverUrl[]> => {
  const rows = await getPublicGalleryCoverKeys();

  // Generate signed URLs for cover photos
  const galleriesWithUrls = await Promise.all(
    rows.map(async (row) => {
      const { cover_thumbnail_key, cover_web_key, cover_width, cover_height, ...gallery } = row;
      const [coverUrl, coverWebUrl] = await Promise.all([
        cover_thumbnail_key ? getSignedUrl(cover_thumbnail_key) : null,
        cover_web_key ? getSignedUrl(cover_web_key) : null,
      ]);
      return { ...gallery, coverUrl, coverWebUrl, coverWidth: cover_width, coverHeight: cover_height };
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
     WHERE gallery_id = $1 AND is_hidden = false
     ORDER BY sort_order ASC, uploaded_at ASC`,
    [galleryId]
  );
  return result.rows;
};

/**
 * Get all galleries (admin only - includes private)
 */
export const getAllGalleries = async (): Promise<Gallery[]> => {
  const result = await query(
    `SELECT * FROM galleries ORDER BY sort_order ASC, created_at DESC`
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
 * Reorder galleries
 * @param galleryIds - Array of gallery IDs in desired order
 */
export const reorderGalleries = async (galleryIds: string[]): Promise<void> => {
  const updates = galleryIds.map((galleryId, index) =>
    query(
      `UPDATE galleries SET sort_order = $1 WHERE id = $2`,
      [index, galleryId]
    )
  );
  await Promise.all(updates);
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
        COUNT(*) FILTER (WHERE featured_order IS NOT NULL) as featured
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
