import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { query } from '../config/db';
import { createPhoto, getPhotosByGalleryId, movePhotos, reorderPhotos } from './photoService';

const db = process.env.TEST_DATABASE_URL;

describe.skipIf(!db)('photo ordering and moves (database)', () => {
  const galleries: string[] = [];
  const photos: string[] = [];

  const gallery = async () => {
    const tag = crypto.randomBytes(4).toString('hex');
    const { rows } = await query(
      `INSERT INTO galleries (title, slug) VALUES ($1, $2) RETURNING id`,
      [`Move ${tag}`, `move-${tag}`]
    );
    galleries.push(rows[0].id);
    return rows[0].id as string;
  };

  const upload = async (galleryId: string | null, name: string) => {
    const tag = crypto.randomBytes(4).toString('hex');
    const photo = await createPhoto({
      gallery_id: galleryId,
      filename: `${name}.jpg`,
      original_filename: name,
      s3_key: `o/${tag}`,
      s3_thumbnail_key: `t/${tag}`,
      s3_web_key: `w/${tag}`,
      width: 100,
      height: 100,
      file_size: 1,
    });
    photos.push(photo.id);
    return photo;
  };

  const names = async (galleryId: string) =>
    (await getPhotosByGalleryId(galleryId)).map((p) => p.original_filename);

  afterAll(async () => {
    if (photos.length) await query(`DELETE FROM photos WHERE id = ANY($1)`, [photos]);
    if (galleries.length) await query(`DELETE FROM galleries WHERE id = ANY($1)`, [galleries]);
  });

  it('stores a new upload in review, so it is not public until shown', async () => {
    const photo = await upload(await gallery(), 'fresh');
    expect(photo).toMatchObject({ review_status: 'review', is_hidden: true });
  });

  it('stores the original content type, and leaves it null when none is given', async () => {
    const tag = crypto.randomBytes(4).toString('hex');
    const png = await createPhoto({
      gallery_id: null,
      filename: `${tag}.png`,
      original_filename: 'logo.png',
      s3_key: `o/${tag}.png`,
      s3_thumbnail_key: `t/${tag}`,
      s3_web_key: `w/${tag}`,
      width: 100,
      height: 100,
      file_size: 1,
      original_content_type: 'image/png',
    });
    photos.push(png.id);
    expect(png.original_content_type).toBe('image/png');
    expect((await upload(null, 'legacy')).original_content_type).toBeNull();
  });

  it('puts a new upload last in a reordered gallery', async () => {
    const g = await gallery();
    const a = await upload(g, 'a');
    const b = await upload(g, 'b');
    const c = await upload(g, 'c');
    await reorderPhotos(g, [c.id, a.id, b.id]);

    const d = await upload(g, 'd');
    expect(d.sort_order).toBe(3);
    expect(await names(g)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('starts an empty gallery at position 0', async () => {
    const g = await gallery();
    expect((await upload(g, 'first')).sort_order).toBe(0);
  });

  it('gives concurrent uploads distinct positions', async () => {
    const g = await gallery();
    await Promise.all(['p', 'q', 'r', 's', 't'].map((n) => upload(g, n)));
    const orders = (await getPhotosByGalleryId(g)).map((p) => p.sort_order);
    expect(orders).toEqual([0, 1, 2, 3, 4]);
  });

  it('appends moved photos after the target, keeping their order', async () => {
    const src = await gallery();
    const dst = await gallery();
    const x = await upload(src, 'x');
    const y = await upload(src, 'y');
    const stays = await upload(src, 'stays');
    await reorderPhotos(src, [y.id, stays.id, x.id]);
    await upload(dst, 'd1');
    await upload(dst, 'd2');

    expect(await movePhotos([x.id, y.id], dst)).toBe(2);
    expect(await names(dst)).toEqual(['d1', 'd2', 'y', 'x']);
    expect(await names(src)).toEqual(['stays']);
  });

  it('leaves S3 keys unchanged on a move', async () => {
    const src = await gallery();
    const dst = await gallery();
    const p = await upload(src, 'keyed');
    await movePhotos([p.id], dst);
    const { rows } = await query(`SELECT s3_key, s3_web_key, s3_thumbnail_key FROM photos WHERE id = $1`, [p.id]);
    expect(rows[0]).toEqual({ s3_key: p.s3_key, s3_web_key: p.s3_web_key, s3_thumbnail_key: p.s3_thumbnail_key });
  });

  it('moves photos back to Unassigned', async () => {
    const g = await gallery();
    const p = await upload(g, 'loose');
    expect(await movePhotos([p.id], null)).toBe(1);
    const { rows } = await query(`SELECT gallery_id FROM photos WHERE id = $1`, [p.id]);
    expect(rows[0].gallery_id).toBeNull();
    expect(await names(g)).toEqual([]);
  });

  it('moves unassigned photos into a gallery', async () => {
    const g = await gallery();
    await upload(g, 'existing');
    const p = await upload(null, 'filed');
    expect(await movePhotos([p.id], g)).toBe(1);
    expect(await names(g)).toEqual(['existing', 'filed']);
  });

  it('skips photos already in the target and unknown ids', async () => {
    const g = await gallery();
    const p = await upload(g, 'home');
    expect(await movePhotos([p.id, crypto.randomUUID()], g)).toBe(0);
    expect((await getPhotosByGalleryId(g))[0].sort_order).toBe(0);
  });

  it('clears the source cover when the cover photo moves', async () => {
    const src = await gallery();
    const dst = await gallery();
    const cover = await upload(src, 'cover');
    await query(`UPDATE galleries SET cover_image_id = $1 WHERE id = $2`, [cover.id, src]);
    await movePhotos([cover.id], dst);
    const { rows } = await query(`SELECT cover_image_id FROM galleries WHERE id = $1`, [src]);
    expect(rows[0].cover_image_id).toBeNull();
  });

  it('changes nothing when the target gallery does not exist', async () => {
    const src = await gallery();
    const p = await upload(src, 'safe');
    await expect(movePhotos([p.id], crypto.randomUUID())).rejects.toThrow();
    const { rows } = await query(`SELECT gallery_id FROM photos WHERE id = $1`, [p.id]);
    expect(rows[0].gallery_id).toBe(src);
  });
});
