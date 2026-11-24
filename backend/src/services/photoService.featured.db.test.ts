import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { query } from '../config/db';
import {
  addToFeatured,
  createPhoto,
  getFeaturedPhotosAdmin,
  removeFromFeatured,
  reorderFeaturedPhotos,
  setHeroPhoto,
} from './photoService';

const db = process.env.TEST_DATABASE_URL;

describe.skipIf(!db)('homepage featured order (database)', () => {
  const galleries: string[] = [];

  const photos = async (count: number) => {
    const tag = crypto.randomBytes(4).toString('hex');
    const { rows } = await query(
      `INSERT INTO galleries (title, slug) VALUES ($1, $2) RETURNING id`,
      [`Featured ${tag}`, `featured-${tag}`]
    );
    const galleryId = rows[0].id as string;
    galleries.push(galleryId);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const key = `${tag}-${i}`;
      const photo = await createPhoto({
        gallery_id: galleryId,
        filename: `${key}.jpg`,
        original_filename: key,
        s3_key: `o/${key}`,
        s3_thumbnail_key: `t/${key}`,
        s3_web_key: `w/${key}`,
        width: 100,
        height: 100,
        file_size: 1,
      });
      ids.push(photo.id);
    }
    return ids;
  };

  const featured = async () =>
    (await getFeaturedPhotosAdmin()).map((p) => ({ id: p.id, order: p.featured_order }));

  const featuredIds = async () => (await featured()).map((p) => p.id);

  const expectDense = async () => {
    const orders = (await featured()).map((p) => p.order);
    expect(orders).toEqual(orders.map((_, i) => i));
  };

  const shuffle = (ids: string[]) => {
    const out = [...ids];
    for (let i = out.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  // The featured order is global, and no other suite features photos.
  beforeEach(async () => {
    await query(`UPDATE photos SET featured_order = NULL, is_featured = false WHERE featured_order IS NOT NULL`);
  });

  afterAll(async () => {
    if (galleries.length) await query(`DELETE FROM galleries WHERE id = ANY($1)`, [galleries]);
  });

  it('adds to the end, makes a hero, and removes without leaving gaps', async () => {
    const [a, b, c, d] = await photos(4);
    for (const id of [a, b, c]) await addToFeatured(id);
    await addToFeatured(b); // already featured: no change
    expect(await featuredIds()).toEqual([a, b, c]);

    await setHeroPhoto(c);
    expect(await featuredIds()).toEqual([c, a, b]);

    await setHeroPhoto(d);
    expect(await featuredIds()).toEqual([d, c, a, b]);

    await removeFromFeatured(a);
    expect(await featuredIds()).toEqual([d, c, b]);
    await expectDense();
  });

  it('keeps featured photos missing from a reorder after the listed ones', async () => {
    const [a, b, c, d] = await photos(4);
    for (const id of [a, b, c, d]) await addToFeatured(id);
    await reorderFeaturedPhotos([c, a, crypto.randomUUID()]);
    expect(await featuredIds()).toEqual([c, a, b, d]);
    await expectDense();
  });

  it('applies concurrent reorders whole, one after another', async () => {
    const ids = await photos(6);
    for (const id of ids) await addToFeatured(id);

    const requests = Array.from({ length: 12 }, () => shuffle(ids));
    await Promise.all(requests.map((order) => reorderFeaturedPhotos(order)));

    const final = await featuredIds();
    await expectDense();
    // Interleaved row-by-row writes would leave a mix of several requests.
    expect(requests.map((r) => r.join())).toContain(final.join());
  });

  it('keeps positions unique under concurrent adds, removes, heroes and reorders', async () => {
    const ids = await photos(8);
    for (const id of ids.slice(0, 4)) await addToFeatured(id);

    await Promise.all([
      ...ids.slice(4).map((id) => addToFeatured(id)),
      removeFromFeatured(ids[1]),
      setHeroPhoto(ids[3]),
      setHeroPhoto(ids[6]),
      reorderFeaturedPhotos(shuffle(ids)),
      removeFromFeatured(ids[5]),
    ]);

    const final = await featured();
    expect(new Set(final.map((p) => p.id)).size).toBe(final.length);
    await expectDense();
  });
});
