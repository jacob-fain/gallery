import { query } from '../config/db';
import { Gallery, Photo } from '../types';

export const getPublicGalleries = async (): Promise<Gallery[]> => {
  const result = await query(
    `SELECT * FROM galleries
     WHERE is_public = true
     ORDER BY created_at DESC`
  );
  return result.rows;
};

export const getGalleryBySlug = async (slug: string): Promise<Gallery | null> => {
  const result = await query(
    `SELECT * FROM galleries WHERE slug = $1`,
    [slug]
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
  await query(
    `UPDATE galleries SET view_count = view_count + 1 WHERE id = $1`,
    [galleryId]
  );
};
