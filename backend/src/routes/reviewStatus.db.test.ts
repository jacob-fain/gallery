import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteFiles } = vi.hoisted(() => ({ deleteFiles: vi.fn() }));
// S3 is the only thing faked: URLs are signed as their keys, and an
// original's bytes are its key.
vi.mock('../services/s3Service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/s3Service')>()),
  getSignedUrl: async (key: string) => `https://signed.example/${key}`,
  getFileStream: async (key: string) => Readable.from([Buffer.from(key)]),
  deleteFiles: (keys: string[]) => deleteFiles(keys),
}));

import { query } from '../config/db';
import { encodeCursor } from '../services/photoPaging';
import { generateGalleryAccessToken } from '../services/authService';
import { useAppServer } from '../../test/appServer';
import { useFixtures } from '../../test/fixtures';

const db = process.env.TEST_DATABASE_URL;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

const ids = (body: { data: { id: string }[] }) => body.data.map((p) => p.id);
const statusOf = async (id: string) =>
  (await query(`SELECT review_status, is_hidden FROM photos WHERE id = $1`, [id])).rows[0];

describe.skipIf(!db)('review status (database)', () => {
  const { request } = useAppServer();
  const fixtures = useFixtures();

  beforeEach(() => {
    deleteFiles.mockReset();
    deleteFiles.mockResolvedValue(0);
  });

  describe('public routes never return a photo in review or rejected', () => {
    it('All Photos', async () => {
      // Dated after every other suite's photos, so a cursor just after them
      // reads only these.
      const at = '3001-01-01T00:00:00Z';
      const shown = await fixtures.photo(null, { uploadedAt: at });
      const hidden: string[] = [];
      for (const status of ['review', 'rejected'] as const) {
        hidden.push((await fixtures.photo(null, { uploadedAt: at, status })).id);
        hidden.push((await fixtures.photo((await fixtures.gallery()).id, { uploadedAt: at, status })).id);
      }
      const start = encodeCursor({ uploadedAt: '3001-01-01T00:00:00.000001Z', id: MISSING_ID });
      const res = await request('GET', `/photos?limit=10&cursor=${start}`, { admin: false });
      expect(ids(res.body)[0]).toBe(shown.id);
      for (const id of hidden) expect(ids(res.body)).not.toContain(id);
    });

    it("a gallery's photos and ZIP, also with a private gallery's token", async () => {
      const pub = await fixtures.gallery();
      const shown = await fixtures.photo(pub.id);
      const [review, rejected] = await fixtures.privatePhotos(pub.id);

      const list = await request('GET', `/galleries/${pub.slug}/photos`, { admin: false });
      expect(ids(list.body)).toEqual([shown.id]);

      const zip = await request('GET', `/galleries/${pub.slug}/download`, { admin: false });
      expect(zip.status).toBe(200);
      expect(zip.raw.includes(Buffer.from(shown.s3_key))).toBe(true);
      expect(zip.raw.includes(Buffer.from(review.s3_key))).toBe(false);
      expect(zip.raw.includes(Buffer.from(rejected.s3_key))).toBe(false);

      const priv = await fixtures.gallery({ isPublic: false, password: 'pw' });
      const [privReview, privRejected] = await fixtures.privatePhotos(priv.id);
      const headers = { 'X-Gallery-Access': generateGalleryAccessToken(priv.id, priv.slug, 0) };
      const unlocked = await request('GET', `/galleries/${priv.slug}/photos`, { admin: false, headers });
      expect(unlocked.status).toBe(200);
      expect(unlocked.body.data).toEqual([]);
      for (const p of [privReview, privRejected]) {
        expect((await request('GET', `/photos/${p.id}`, { admin: false, headers })).status).toBe(404);
      }
    });

    it('a ZIP of a gallery with no shown photo is refused as empty', async () => {
      const g = await fixtures.gallery();
      await fixtures.privatePhotos(g.id);
      const res = await request('GET', `/galleries/${g.slug}/download`, { admin: false });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Gallery has no photos');
    });

    it('a cover chosen from photos that are not shown', async () => {
      const g = await fixtures.gallery();
      const [review, rejected] = await fixtures.privatePhotos(g.id);
      for (const cover of [review, rejected]) {
        await query(`UPDATE galleries SET cover_image_id = $1 WHERE id = $2`, [cover.id, g.id]);
        const list = await request('GET', '/galleries', { admin: false });
        const card = list.body.data.find((row: { id: string }) => row.id === g.id);
        expect(card).toMatchObject({ coverUrl: null, coverWebUrl: null, photoCount: 0 });
      }
    });

    it('the homepage hero refuses a photo that is not shown', async () => {
      for (const status of ['review', 'rejected'] as const) {
        const p = await fixtures.photo(null, { status });
        const res = await request('POST', '/admin/homepage/hero', { body: { photo_id: p.id } });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Show this photo on the site before making it the hero');
        expect((await query(`SELECT featured_order FROM photos WHERE id = $1`, [p.id])).rows[0].featured_order).toBeNull();
      }
    });
  });

  describe('admin session and Origin', () => {
    it.each([
      ['GET', '/photos/admin/all'],
      ['PUT', '/photos/status'],
      ['DELETE', '/photos/admin/rejected?gallery=all'],
    ])('%s %s needs a session', async (method, path) => {
      const res = await request(method, path, { session: false, body: method === 'GET' ? undefined : {} });
      expect(res.status).toBe(401);
    });

    it.each([
      ['PUT', '/photos/status'],
      ['DELETE', '/photos/admin/rejected?gallery=all'],
    ])('%s %s refuses a request without the admin Origin', async (method, path) => {
      const p = await fixtures.photo(null, { status: 'rejected' });
      const res = await request(method, path, {
        admin: false,
        session: true,
        body: { photo_ids: [p.id], review_status: 'shown' },
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Request origin not allowed');
      expect((await statusOf(p.id)).review_status).toBe('rejected');
    });
  });

  describe('PUT /photos/status', () => {
    it('puts every listed photo in the state, skipping those already in it', async () => {
      const g = await fixtures.gallery();
      const [review, rejected] = await fixtures.privatePhotos(g.id);
      const shown = await fixtures.photo(g.id);

      const res = await request('PUT', '/photos/status', {
        body: { photo_ids: [review.id, rejected.id, shown.id, MISSING_ID], review_status: 'shown' },
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ updated: 2 });
      for (const p of [review, rejected, shown]) {
        expect(await statusOf(p.id)).toEqual({ review_status: 'shown', is_hidden: false });
      }
      const pub = await request('GET', `/galleries/${g.slug}/photos`, { admin: false });
      expect(ids(pub.body).sort()).toEqual([review.id, rejected.id, shown.id].sort());

      const back = await request('PUT', '/photos/status', { body: { photo_ids: [shown.id], review_status: 'review' } });
      expect(back.body.data).toEqual({ updated: 1 });
      expect(await statusOf(shown.id)).toEqual({ review_status: 'review', is_hidden: true });
    });

    it.each([
      [{ photo_ids: [], review_status: 'shown' }, 'photo_ids must be a list of 1 to 5000 ids'],
      [{ photo_ids: ['nope'], review_status: 'shown' }, 'photo_ids must be a list of 1 to 5000 ids'],
      [{ photo_ids: [MISSING_ID] }, 'review_status must be one of review, shown, rejected'],
      [{ photo_ids: [MISSING_ID], review_status: 'hidden' }, 'review_status must be one of review, shown, rejected'],
    ])('refuses %j', async (body, error) => {
      const res = await request('PUT', '/photos/status', { body });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(error);
    });
  });

  describe('GET /photos/admin/all', () => {
    it('lists every gallery and Unassigned newest first, with gallery titles, counts and pages', async () => {
      const g = await fixtures.gallery();
      const other = await fixtures.gallery();
      const at = (n: number) => `3002-01-01T00:00:0${n}Z`;
      const inG = await fixtures.photo(g.id, { uploadedAt: at(1), status: 'review' });
      const loose = await fixtures.photo(null, { uploadedAt: at(2), status: 'rejected' });
      const inOther = await fixtures.photo(other.id, { uploadedAt: at(3) });

      const all = await request('GET', '/photos/admin/all?limit=3');
      expect(all.status).toBe(200);
      expect(ids(all.body)).toEqual([inOther.id, loose.id, inG.id]);
      expect(all.body.data.map((p: { gallery_title: string | null }) => p.gallery_title)).toEqual([
        other.title,
        null,
        g.title,
      ]);
      expect(all.body.data[0].thumbnailUrl).toBe(`https://signed.example/${inOther.s3_thumbnail_key}`);
      expect(all.body.nextOffset).toBe(3);
      expect(all.body.counts.all).toBe(all.body.total);

      const second = await request('GET', '/photos/admin/all?limit=2&offset=1');
      expect(ids(second.body)).toEqual([loose.id, inG.id]);

      const oneGallery = await request('GET', `/photos/admin/all?gallery=${g.id}`);
      expect(ids(oneGallery.body)).toEqual([inG.id]);
      expect(oneGallery.body).toMatchObject({
        total: 1,
        nextOffset: null,
        counts: { review: 1, shown: 0, rejected: 0, all: 1 },
      });
      expect(oneGallery.body.data[0].gallery_title).toBe(g.title);

      const unassigned = await request('GET', '/photos/admin/all?gallery=unassigned&status=rejected&limit=1');
      expect(ids(unassigned.body)).toEqual([loose.id]);
      expect(unassigned.body.data[0].gallery_title).toBeNull();

      const shownOnly = await request('GET', '/photos/admin/all?status=shown&limit=1');
      expect(ids(shownOnly.body)).toEqual([inOther.id]);
      expect(shownOnly.body.total).toBe(shownOnly.body.counts.shown);
    });

    it.each([
      ['?gallery=nope', 400, 'gallery must be all, unassigned or a gallery id'],
      [`?gallery=${MISSING_ID}`, 404, 'Gallery not found'],
      ['?status=hidden', 400, 'status must be review, shown, rejected or all'],
      ['?limit=0', 400, 'limit must be a positive integer'],
    ])('refuses %s', async (q, status, error) => {
      const res = await request('GET', `/photos/admin/all${q}`);
      expect(res.status).toBe(status);
      expect(res.body.error).toBe(error);
    });
  });

  describe('GET /photos/admin/unassigned', () => {
    it('filters by status, with counts for all of Unassigned', async () => {
      const p = await fixtures.photo(null, { status: 'review', uploadedAt: '3003-01-01T00:00:00Z' });
      const res = await request('GET', '/photos/admin/unassigned?status=review&limit=1');
      expect(ids(res.body)).toEqual([p.id]);
      expect(res.body.total).toBe(res.body.counts.review);
      expect(res.body.counts.all).toBeGreaterThanOrEqual(res.body.counts.review);
      expect((await request('GET', '/photos/admin/unassigned?status=x')).status).toBe(400);
    });
  });

  // Only a gallery this suite owns is emptied: Unassigned and "all" would
  // also delete other suites' photos while they run. Those scopes are
  // covered in photoController.rejected.test.ts.
  describe('DELETE /photos/admin/rejected', () => {
    it("deletes a gallery's rejected photos and their files, and nothing else", async () => {
      const g = await fixtures.gallery();
      const other = await fixtures.gallery();
      const shown = await fixtures.photo(g.id);
      const [review, rejected] = await fixtures.privatePhotos(g.id);
      const rejected2 = await fixtures.photo(g.id, { status: 'rejected' });
      const [, elsewhere] = await fixtures.privatePhotos(other.id);
      await query(`UPDATE galleries SET cover_image_id = $1 WHERE id = $2`, [rejected.id, g.id]);

      const res = await request('DELETE', `/photos/admin/rejected?gallery=${g.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ deleted: 2, counts: { review: 1, shown: 1, rejected: 0, all: 2 } });
      expect(deleteFiles).toHaveBeenCalledOnce();
      expect([...deleteFiles.mock.calls[0][0]].sort()).toEqual(
        [rejected, rejected2].flatMap((p) => [p.s3_key, p.s3_web_key, p.s3_thumbnail_key]).sort()
      );

      const left = await query(`SELECT id FROM photos WHERE id = ANY($1)`, [
        [shown.id, review.id, rejected.id, rejected2.id, elsewhere.id],
      ]);
      expect(left.rows.map((r) => r.id).sort()).toEqual([shown.id, review.id, elsewhere.id].sort());
      const cover = await query(`SELECT cover_image_id FROM galleries WHERE id = $1`, [g.id]);
      expect(cover.rows[0].cover_image_id).toBeNull();

      const again = await request('DELETE', `/photos/admin/rejected?gallery=${g.id}`);
      expect(again.body.data.deleted).toBe(0);
    });

    it.each([
      ['', 400, 'gallery must be all, unassigned or a gallery id'],
      ['?gallery=', 400, 'gallery must be all, unassigned or a gallery id'],
      [`?gallery=${MISSING_ID}`, 404, 'Gallery not found'],
    ])('refuses %s', async (q, status, error) => {
      const res = await request('DELETE', `/photos/admin/rejected${q}`);
      expect(res.status).toBe(status);
      expect(res.body.error).toBe(error);
      expect(deleteFiles).not.toHaveBeenCalled();
    });
  });
});
