import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { query } from '../config/db';
import { getPublicGalleryCoverKeys } from './galleryService';

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

  const photo = async (galleryId: string, name: string, sortOrder: number, hidden = false) => {
    const { rows } = await query(
      `INSERT INTO photos (gallery_id, filename, original_filename, s3_key, s3_thumbnail_key,
                           s3_web_key, width, height, file_size, sort_order, is_hidden)
       VALUES ($1, $2, $2, $3, $4, $5, 100, 100, 1, $6, $7) RETURNING id`,
      [galleryId, name, `o/${name}`, `t/${name}`, `w/${name}`, sortOrder, hidden]
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

  it('uses the chosen cover while it is visible', async () => {
    const g = await gallery();
    await photo(g, 'first', 0);
    const chosen = await photo(g, 'chosen', 1);
    await query(`UPDATE galleries SET cover_image_id = $1 WHERE id = $2`, [chosen, g]);
    expect(await coverOf(g)).toBe('t/chosen');
  });

  it('falls back to the first visible photo when the chosen cover is hidden', async () => {
    const g = await gallery();
    await photo(g, 'hidden-first', 0, true);
    await photo(g, 'visible', 1);
    const chosen = await photo(g, 'chosen', 2);
    await query(`UPDATE galleries SET cover_image_id = $1 WHERE id = $2`, [chosen, g]);
    await query(`UPDATE photos SET is_hidden = true WHERE id = $1`, [chosen]);
    expect(await coverOf(g)).toBe('t/visible');
  });

  it('falls back when no cover is chosen, skipping hidden photos', async () => {
    const g = await gallery();
    await photo(g, 'hidden', 0, true);
    await photo(g, 'shown', 1);
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

  it('has no cover when every photo is hidden', async () => {
    const g = await gallery();
    const only = await photo(g, 'only', 0, true);
    await query(`UPDATE galleries SET cover_image_id = $1 WHERE id = $2`, [only, g]);
    expect(await coverOf(g)).toBeNull();
  });
});
