import crypto from 'crypto';
import { afterAll } from 'vitest';
import { query } from '../src/config/db';
import { hashPassword } from '../src/services/authService';
import { createPhoto } from '../src/services/photoService';
import type { ReviewStatus } from '../src/services/reviewStatus';

export const tag = () => crypto.randomBytes(4).toString('hex');

/**
 * Galleries and photos for one test file, removed after it. Other files share
 * the database, so every slug and key is random and nothing here assumes it
 * holds the only rows.
 */
export function useFixtures() {
  const galleries: string[] = [];
  const photos: string[] = [];

  afterAll(async () => {
    if (photos.length) await query(`DELETE FROM photos WHERE id = ANY($1)`, [photos]);
    if (galleries.length) await query(`DELETE FROM galleries WHERE id = ANY($1)`, [galleries]);
  });

  const gallery = async (opts: { isPublic?: boolean; password?: string } = {}) => {
    const slug = `fixture-${tag()}`;
    const hash = opts.password ? await hashPassword(opts.password) : null;
    const { rows } = await query(
      `INSERT INTO galleries (title, slug, is_public, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`Gallery ${slug}`, slug, opts.isPublic ?? true, hash]
    );
    galleries.push(rows[0].id);
    return { id: rows[0].id as string, slug, title: `Gallery ${slug}` };
  };

  /** A photo row; new uploads start in review, so this one is shown unless asked. */
  const photo = async (
    galleryId: string | null,
    opts: { status?: ReviewStatus; contentHash?: string; uploadedAt?: string } = {}
  ) => {
    const t = tag();
    const row = await createPhoto({
      gallery_id: galleryId,
      filename: `${t}.jpg`,
      original_filename: `photo-${t}.jpg`,
      s3_key: `originals/${t}`,
      s3_thumbnail_key: `thumbnails/${t}`,
      s3_web_key: `web/${t}`,
      width: 600,
      height: 400,
      file_size: 1,
      content_hash: opts.contentHash,
    });
    photos.push(row.id);
    const status = opts.status ?? 'shown';
    await query(
      `UPDATE photos SET review_status = $2, uploaded_at = COALESCE($3::timestamptz, uploaded_at) WHERE id = $1`,
      [row.id, status, opts.uploadedAt ?? null]
    );
    return { ...row, review_status: status, is_hidden: status !== 'shown' };
  };

  /** Registers a gallery created through the API for cleanup. */
  const adopt = (galleryId: string) => galleries.push(galleryId);

  /** One photo in each private state: what no public route may ever return. */
  const privatePhotos = async (galleryId: string | null) => [
    await photo(galleryId, { status: 'review' }),
    await photo(galleryId, { status: 'rejected' }),
  ];

  return { gallery, photo, privatePhotos, adopt };
}
