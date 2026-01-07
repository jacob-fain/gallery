import { query } from '../config/db';
import { Photo } from '../types';

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
