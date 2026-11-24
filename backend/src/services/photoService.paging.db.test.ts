import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { query } from '../config/db';
import {
  createPhoto,
  getGalleryPhotosAdmin,
  getPublicPhotosPage,
  getUnassignedPhotos,
  reorderPhotos,
} from './photoService';
import type { PublicCursor } from './photoPaging';

const db = process.env.TEST_DATABASE_URL;

// Other test files share this database and add photos uploaded now, so the
// photos here are dated far in the future: they are the newest in every
// list, and each assertion reads only the front of a list.
describe.skipIf(!db)('paged photo lists (database)', () => {
  const galleries: string[] = [];
  const photos: string[] = [];

  const gallery = async (isPublic = true) => {
    const tag = crypto.randomBytes(4).toString('hex');
    const { rows } = await query(
      `INSERT INTO galleries (title, slug, is_public) VALUES ($1, $2, $3) RETURNING id`,
      [`Paging ${tag}`, `paging-${tag}`, isPublic]
    );
    galleries.push(rows[0].id);
    return rows[0].id as string;
  };

  const upload = async (
    galleryId: string | null,
    name: string,
    opts: { uploadedAt?: string; hidden?: boolean } = {}
  ) => {
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
    await query(
      `UPDATE photos SET is_hidden = $2, uploaded_at = COALESCE($3::timestamptz, uploaded_at) WHERE id = $1`,
      [photo.id, opts.hidden ?? false, opts.uploadedAt ?? null]
    );
    return photo.id;
  };

  afterAll(async () => {
    if (photos.length) await query(`DELETE FROM photos WHERE id = ANY($1)`, [photos]);
    if (galleries.length) await query(`DELETE FROM galleries WHERE id = ANY($1)`, [galleries]);
  });

  it('pages the public photos newest first with no repeats or gaps, down to the microsecond', async () => {
    const pub = await gallery(true);
    const priv = await gallery(false);
    const t = '2999-06-01 12:00:00';
    // Two photos a microsecond apart (one Date apart: none) and two sharing
    // a timestamp, which the id orders.
    const newest = await upload(pub, 'newest', { uploadedAt: `${t}.000003+00` });
    const loose = await upload(null, 'loose', { uploadedAt: `${t}.000002+00` });
    const tieA = await upload(pub, 'tieA', { uploadedAt: `${t}.000001+00` });
    const tieB = await upload(pub, 'tieB', { uploadedAt: `${t}.000001+00` });
    const oldest = await upload(pub, 'oldest', { uploadedAt: `${t}.000000+00` });
    // One public photo older than the five under test, so the fifth page is
    // never the last one, even on an otherwise empty database.
    await upload(pub, 'older', { uploadedAt: '2999-05-31 12:00:00+00' });
    await upload(pub, 'hidden', { uploadedAt: `${t}.000004+00`, hidden: true });
    await upload(priv, 'private', { uploadedAt: `${t}.000004+00` });
    const ties = [tieA, tieB].sort().reverse();
    const expected = [newest, loose, ...ties, oldest];

    const seen: string[] = [];
    let after: PublicCursor | null = null;
    for (let i = 0; i < expected.length; i++) {
      const page: Awaited<ReturnType<typeof getPublicPhotosPage>> = await getPublicPhotosPage(1, after);
      expect(page.photos).toHaveLength(1);
      expect(page.next).not.toBeNull();
      seen.push(page.photos[0].id);
      after = page.next;
    }
    expect(seen).toEqual(expected);

    const firstTwo = await getPublicPhotosPage(2);
    expect(firstTwo.photos.map((p) => p.id)).toEqual([newest, loose]);
    expect(firstTwo.next).toEqual({ uploadedAt: '2999-06-01T12:00:00.000002Z', id: loose });
    // The cursor column is internal to the query.
    expect(firstTwo.photos[0]).not.toHaveProperty('cursor_uploaded_at');
  });

  it('returns no next cursor on the last page', async () => {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM photos p LEFT JOIN galleries g ON g.id = p.gallery_id
       WHERE p.is_hidden = false AND (g.is_public = true OR p.gallery_id IS NULL)`
    );
    const all = await getPublicPhotosPage(rows[0].n + 1000);
    expect(all.next).toBeNull();
  });

  it('pages a gallery for the admin in gallery order, hidden photos included', async () => {
    const g = await gallery();
    const ids: string[] = [];
    for (const name of ['a', 'b', 'c', 'd', 'e']) ids.push(await upload(g, name, { hidden: name === 'c' }));

    const first = await getGalleryPhotosAdmin(g, { limit: 2, offset: 0 });
    const second = await getGalleryPhotosAdmin(g, { limit: 2, offset: 2 });
    const last = await getGalleryPhotosAdmin(g, { limit: 2, offset: 4 });
    const past = await getGalleryPhotosAdmin(g, { limit: 2, offset: 10 });
    expect([first, second, last, past].map((p) => p.total)).toEqual([5, 5, 5, 5]);
    expect([...first.photos, ...second.photos, ...last.photos].map((p) => p.id)).toEqual(ids);
    expect(past.photos).toEqual([]);

    const whole = await getGalleryPhotosAdmin(g);
    expect(whole.total).toBe(5);
    expect(whole.photos.map((p) => p.id)).toEqual(ids);
  });

  it('pages the unassigned photos newest first', async () => {
    const t = '3000-01-01 00:00:00';
    const older = await upload(null, 'u-older', { uploadedAt: `${t}.000001+00`, hidden: true });
    const newer = await upload(null, 'u-newer', { uploadedAt: `${t}.000002+00`, hidden: true });
    const page = await getUnassignedPhotos({ limit: 2, offset: 0 });
    expect(page.photos.map((p) => p.id)).toEqual([newer, older]);
    expect(page.total).toBeGreaterThanOrEqual(2);
  });

  it('keeps photos left out of a reorder after the listed ones, in their old order', async () => {
    const g = await gallery();
    const [a, b, c, d, e] = [
      await upload(g, 'a'),
      await upload(g, 'b'),
      await upload(g, 'c'),
      await upload(g, 'd'),
      await upload(g, 'e'),
    ];
    // The admin has loaded the first page (a, b, c) and drags c to the front.
    await reorderPhotos(g, [c, a, b]);
    const after = await getGalleryPhotosAdmin(g);
    expect(after.photos.map((p) => [p.id, p.sort_order])).toEqual([
      [c, 0],
      [a, 1],
      [b, 2],
      [d, 3],
      [e, 4],
    ]);
  });
});
