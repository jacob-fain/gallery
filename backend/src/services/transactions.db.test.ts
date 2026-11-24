import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { query, withTransaction } from '../config/db';
import {
  deleteGallery,
  getAllGalleries,
  PrivateGalleryNeedsPasswordError,
  reorderGalleries,
  updateGallery,
} from './galleryService';
import { createPhoto, getPhotosByGalleryId, reorderPhotos } from './photoService';
import { getAllSettings, updateSettings } from './settingsService';

const db = process.env.TEST_DATABASE_URL;

describe.skipIf(!db)('multi-step writes (database)', () => {
  const galleries: string[] = [];

  const gallery = async (isPublic = true) => {
    const tag = crypto.randomBytes(4).toString('hex');
    const { rows } = await query(
      `INSERT INTO galleries (title, slug, is_public) VALUES ($1, $2, $3) RETURNING id`,
      [`Tx ${tag}`, `tx-${tag}`, isPublic]
    );
    galleries.push(rows[0].id);
    return rows[0].id as string;
  };

  const upload = (galleryId: string, name: string) => {
    const key = `${name}-${crypto.randomBytes(4).toString('hex')}`;
    return createPhoto({
      gallery_id: galleryId,
      filename: `${key}.jpg`,
      original_filename: name,
      s3_key: `o/${key}`,
      s3_thumbnail_key: `t/${key}`,
      s3_web_key: `w/${key}`,
      width: 100,
      height: 100,
      file_size: 1,
    });
  };

  afterAll(async () => {
    if (galleries.length) await query(`DELETE FROM galleries WHERE id = ANY($1)`, [galleries]);
  });

  it('rolls back every statement of a transaction that throws', async () => {
    const slug = `tx-rollback-${crypto.randomBytes(4).toString('hex')}`;
    await expect(
      withTransaction(async (client) => {
        await client.query(`INSERT INTO galleries (title, slug) VALUES ('Rolled back', $1)`, [slug]);
        await client.query(`SELECT 1 / 0`);
      })
    ).rejects.toThrow(/division by zero/);
    const { rowCount } = await query(`SELECT 1 FROM galleries WHERE slug = $1`, [slug]);
    expect(rowCount).toBe(0);
  });

  it('saves no setting when one key in the batch fails', async () => {
    const before = await getAllSettings();
    await expect(
      updateSettings({ site_title: 'Never saved', ['k'.repeat(101)]: 'too long a key' })
    ).rejects.toThrow();
    expect((await getAllSettings()).site_title).toBe(before.site_title);
  });

  it('refuses an edit that leaves a private gallery without a password, changing nothing', async () => {
    const g = await gallery(true);
    await expect(updateGallery(g, { title: 'Changed', is_public: false })).rejects.toBeInstanceOf(
      PrivateGalleryNeedsPasswordError
    );
    const { rows } = await query(`SELECT title, is_public FROM galleries WHERE id = $1`, [g]);
    expect(rows[0].is_public).toBe(true);
    expect(rows[0].title).toMatch(/^Tx /);
  });

  it('deletes a gallery with its photos and returns exactly their S3 keys', async () => {
    const g = await gallery();
    const a = await upload(g, 'a');
    const b = await upload(g, 'b');
    const result = await deleteGallery(g);
    expect(result?.s3Keys.sort()).toEqual(
      [a, b].flatMap((p) => [p.s3_key, p.s3_web_key, p.s3_thumbnail_key]).sort()
    );
    const { rowCount } = await query(`SELECT 1 FROM photos WHERE id = ANY($1)`, [[a.id, b.id]]);
    expect(rowCount).toBe(0);
    expect(await deleteGallery(g)).toBeNull();
  });

  it('reorders photos in one statement, ignoring other galleries and repeats', async () => {
    const g = await gallery();
    const other = await gallery();
    const a = await upload(g, 'a');
    const b = await upload(g, 'b');
    const c = await upload(g, 'c');
    const foreign = await upload(other, 'foreign');
    await reorderPhotos(g, [c.id, foreign.id, a.id, c.id, b.id]);
    expect((await getPhotosByGalleryId(g)).map((p) => [p.original_filename, p.sort_order])).toEqual([
      ['c', 0],
      ['a', 2],
      ['b', 4],
    ]);
    expect((await getPhotosByGalleryId(other))[0].sort_order).toBe(0);
  });

  it('reorders galleries in one statement', async () => {
    const x = await gallery();
    const y = await gallery();
    await reorderGalleries([y, x]);
    const order = (await getAllGalleries()).filter((g) => g.id === x || g.id === y).map((g) => g.id);
    expect(order).toEqual([y, x]);
  });
});
