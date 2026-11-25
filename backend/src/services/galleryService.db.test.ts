import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { query } from '../config/db';
import { countVisiblePhotos, getPublicGalleryCoverKeys } from './galleryService';

const db = process.env.TEST_DATABASE_URL;

describe.skipIf(!db)('getPublicGalleryCoverKeys (database)', () => {
  const created: string[] = [];

  const gallery = async () => {
    const tag = crypto.randomBytes(4).toString('hex');
    const { rows } = await query(
      `INSERT INTO galleries (title, slug, is_public) VALUES ($1, $2, true) RETURNING id`,
      [`Cover ${tag}`, `cover-${tag}`]
    );
    created.push(rows[0].id);
    return rows[0].id as string;
  };

  const photo = async (
    galleryId: string,
    name: string,
    sortOrder: number,
    status: 'review' | 'shown' | 'rejected' = 'shown'
  ) => {
    const { rows } = await query(
      `INSERT INTO photos (gallery_id, filename, original_filename, s3_key, s3_thumbnail_key,
                           s3_web_key, width, height, file_size, sort_order, review_status)
       VALUES ($1, $2, $2, $3, $4, $5, 100, 100, 1, $6, $7) RETURNING id`,
      [galleryId, name, `o/${name}`, `t/${name}`, `w/${name}`, sortOrder, status]
    );
    return rows[0].id as string;
  };

  const coverOf = async (galleryId: string) =>
    (await getPublicGalleryCoverKeys()).find((g) => g.id === galleryId)?.cover_thumbnail_key;

  afterAll(async () => {
    if (created.length) {
      await query(`DELETE FROM galleries WHERE id = ANY($1)`, [created]);
    }
  });

  it('uses the chosen cover while it is shown', async () => {
    const g = await gallery();
    await photo(g, 'first', 0);
    const chosen = await photo(g, 'chosen', 1);
    await query(`UPDATE galleries SET cover_image_id = $1 WHERE id = $2`, [chosen, g]);
    expect(await coverOf(g)).toBe('t/chosen');
  });

  it.each(['review', 'rejected'] as const)(
    'falls back to the first shown photo when the chosen cover is in %s',
    async (status) => {
      const g = await gallery();
      await photo(g, 'review-first', 0, 'review');
      await photo(g, 'rejected-second', 1, 'rejected');
      await photo(g, 'visible', 2);
      const chosen = await photo(g, 'chosen', 3);
      await query(`UPDATE galleries SET cover_image_id = $1 WHERE id = $2`, [chosen, g]);
      await query(`UPDATE photos SET review_status = $2 WHERE id = $1`, [chosen, status]);
      expect(await coverOf(g)).toBe('t/visible');
    }
  );

  it('falls back when no cover is chosen, skipping photos that are not shown', async () => {
    const g = await gallery();
    await photo(g, 'review', 0, 'review');
    await photo(g, 'rejected', 1, 'rejected');
    await photo(g, 'shown', 2);
    expect(await coverOf(g)).toBe('t/shown');
  });

  it('takes every cover field from the same photo', async () => {
    const g = await gallery();
    await photo(g, 'first', 0);
    const chosen = await photo(g, 'chosen', 1);
    await query(`UPDATE photos SET width = 4000, height = 2667 WHERE id = $1`, [chosen]);
    await query(`UPDATE galleries SET cover_image_id = $1 WHERE id = $2`, [chosen, g]);
    const row = (await getPublicGalleryCoverKeys()).find((r) => r.id === g);
    expect(row).toMatchObject({
      cover_thumbnail_key: 't/chosen',
      cover_web_key: 'w/chosen',
      cover_width: 4000,
      cover_height: 2667,
    });
  });

  it('has no cover when no photo is shown', async () => {
    const g = await gallery();
    await photo(g, 'waiting', 1, 'review');
    const only = await photo(g, 'only', 0, 'rejected');
    await query(`UPDATE galleries SET cover_image_id = $1 WHERE id = $2`, [only, g]);
    expect(await coverOf(g)).toBeNull();
  });

  it('counts only shown photos, in the same query, matching the single-gallery count', async () => {
    const g = await gallery();
    await photo(g, 'a', 0);
    await photo(g, 'b', 1);
    await photo(g, 'c', 2, 'rejected');
    await photo(g, 'd', 3, 'review');
    const other = await gallery();
    await photo(other, 'elsewhere', 0);
    const rows = await getPublicGalleryCoverKeys();
    expect(rows.find((r) => r.id === g)?.photo_count).toBe(2);
    expect(rows.find((r) => r.id === other)?.photo_count).toBe(1);
    expect(await countVisiblePhotos(g)).toBe(2);
  });

  it('counts zero for a gallery with no shown photo', async () => {
    const g = await gallery();
    await photo(g, 'only', 0, 'rejected');
    await photo(g, 'new', 1, 'review');
    expect((await getPublicGalleryCoverKeys()).find((r) => r.id === g)?.photo_count).toBe(0);
  });
});
