import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deletePhotoFiles } = vi.hoisted(() => ({ deletePhotoFiles: vi.fn() }));
vi.mock('../services/s3Service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/s3Service')>()),
  getSignedUrl: async (key: string) => `https://signed.example/${key}`,
  deletePhotoFiles: (keys: string[], id: string) => deletePhotoFiles(keys, id),
}));

import { query } from '../config/db';
import { generateGalleryAccessToken } from '../services/authService';
import { encodeCursor } from '../services/photoPaging';
import { useAppServer } from '../../test/appServer';
import { useFixtures } from '../../test/fixtures';

const db = process.env.TEST_DATABASE_URL;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const sha = () => crypto.randomBytes(32).toString('hex');

describe.skipIf(!db)('photo routes (database)', () => {
  const { request } = useAppServer();
  const fixtures = useFixtures();

  beforeEach(() => {
    deletePhotoFiles.mockReset();
    deletePhotoFiles.mockResolvedValue(undefined);
  });

  describe('GET /photos/:id', () => {
    it('answers a visible photo with signed URLs and no storage keys', async () => {
      const p = await fixtures.photo((await fixtures.gallery()).id);
      const res = await request('GET', `/photos/${p.id}`, { admin: false });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: p.id, webUrl: `https://signed.example/${p.s3_web_key}` });
      expect(res.body.data).not.toHaveProperty('s3_key');
    });

    it('answers a hidden photo exactly like a missing one', async () => {
      const hidden = await fixtures.photo((await fixtures.gallery()).id, { hidden: true });
      const a = await request('GET', `/photos/${hidden.id}`, { admin: false });
      const b = await request('GET', `/photos/${MISSING_ID}`, { admin: false });
      expect(a.status).toBe(404);
      expect(a.body).toEqual(b.body);
    });

    it("shows a private gallery's photo only with that gallery's token", async () => {
      const g = await fixtures.gallery({ isPublic: false, password: 'pw' });
      const p = await fixtures.photo(g.id);
      expect((await request('GET', `/photos/${p.id}`, { admin: false })).status).toBe(404);
      const token = encodeURIComponent(generateGalleryAccessToken(g.id, g.slug, 0));
      expect((await request('GET', `/photos/${p.id}?access=${token}`, { admin: false })).status).toBe(200);
    });
  });

  describe('GET /photos/:id/download', () => {
    it('signs the original under a download name', async () => {
      const p = await fixtures.photo(null);
      const res = await request('GET', `/photos/${p.id}/download`, { admin: false });
      expect(res.status).toBe(200);
      expect(res.body.data.downloadUrl).toBe(`https://signed.example/${p.s3_key}`);
      expect(res.body.data.filename).toMatch(/\.jpg$/);
    });

    it('answers 404 for a hidden photo', async () => {
      const p = await fixtures.photo(null, { hidden: true });
      expect((await request('GET', `/photos/${p.id}/download`, { admin: false })).status).toBe(404);
    });
  });

  describe('GET /photos', () => {
    it('refuses a bad limit or cursor', async () => {
      expect((await request('GET', '/photos?limit=0', { admin: false })).status).toBe(400);
      expect((await request('GET', '/photos?cursor=nonsense', { admin: false })).status).toBe(400);
    });

    it('pages the public photos newest first', async () => {
      // Other files share the database, so the pages start from a cursor
      // just after these two photos instead of at the front of the list.
      const older = await fixtures.photo(null, { uploadedAt: '2999-01-01T00:00:00Z' });
      const newer = await fixtures.photo(null, { uploadedAt: '2999-01-02T00:00:00Z' });
      const start = encodeCursor({ uploadedAt: '2999-01-03T00:00:00.000000Z', id: MISSING_ID });

      const first = await request('GET', `/photos?limit=1&cursor=${start}`, { admin: false });
      expect(first.status).toBe(200);
      expect(first.body.data.map((p: { id: string }) => p.id)).toEqual([newer.id]);
      expect(first.headers.get('cache-control')).toContain('public');

      const next = await request('GET', `/photos?limit=1&cursor=${first.body.nextCursor}`, { admin: false });
      expect(next.body.data.map((p: { id: string }) => p.id)).toEqual([older.id]);
    });
  });

  describe('GET /photos/admin/unassigned', () => {
    it('lists photos with no gallery, hidden ones included', async () => {
      const hidden = await fixtures.photo(null, { hidden: true });
      const res = await request('GET', '/photos/admin/unassigned');
      expect(res.status).toBe(200);
      expect(res.body.data).toContainEqual(expect.objectContaining({ id: hidden.id, is_hidden: true }));
      expect(res.body.nextOffset).toBeNull();
    });

    it('needs the admin session', async () => {
      expect((await request('GET', '/photos/admin/unassigned', { session: false })).status).toBe(401);
    });
  });

  describe('POST /photos/admin/check-duplicates', () => {
    it('names the stored photo for each known hash', async () => {
      const g = await fixtures.gallery();
      const hash = sha();
      const p = await fixtures.photo(g.id, { contentHash: hash });
      const unknown = sha();

      const res = await request('POST', '/photos/admin/check-duplicates', { body: { hashes: [hash, unknown] } });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        [hash]: { id: p.id, original_filename: p.original_filename, gallery_id: g.id, gallery_title: g.title },
      });
    });

    it.each([
      [{ hashes: [] }, 'hashes must be a non-empty array'],
      [{ hashes: 'abc' }, 'hashes must be a non-empty array'],
      [{ hashes: ['ABC'] }, 'hashes must be lowercase SHA-256 hex strings'],
      [{ hashes: Array.from({ length: 1001 }, () => 'a'.repeat(64)) }, 'Maximum 1000 hashes per request'],
    ])('refuses a bad request', async (body, error) => {
      const res = await request('POST', '/photos/admin/check-duplicates', { body });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(error);
    });
  });

  describe('PUT /photos/:id', () => {
    it('hides and shows a photo, and ignores is_featured', async () => {
      const p = await fixtures.photo(null);

      const hidden = await request('PUT', `/photos/${p.id}`, { body: { is_hidden: true, is_featured: true } });
      expect(hidden.status).toBe(200);
      expect(hidden.body.data).toMatchObject({ id: p.id, is_hidden: true, featured_order: null });

      const shown = await request('PUT', `/photos/${p.id}`, { body: { is_hidden: false } });
      expect(shown.body.data.is_hidden).toBe(false);
    });

    it('answers 404 for an unknown photo', async () => {
      expect((await request('PUT', `/photos/${MISSING_ID}`, { body: { is_hidden: true } })).status).toBe(404);
    });
  });

  describe('DELETE /photos/:id', () => {
    it('removes the files and the row', async () => {
      const p = await fixtures.photo(null);

      const res = await request('DELETE', `/photos/${p.id}`);
      expect(res.body.data).toEqual({ deleted: true });
      expect(deletePhotoFiles).toHaveBeenCalledWith([p.s3_key, p.s3_web_key, p.s3_thumbnail_key], p.id);
      expect((await query(`SELECT 1 FROM photos WHERE id = $1`, [p.id])).rowCount).toBe(0);

      expect((await request('DELETE', `/photos/${p.id}`)).status).toBe(404);
    });
  });

  describe('PUT /photos/reorder', () => {
    it("stores a gallery's new photo order", async () => {
      const g = await fixtures.gallery();
      const a = await fixtures.photo(g.id);
      const b = await fixtures.photo(g.id);

      const res = await request('PUT', '/photos/reorder', { body: { gallery_id: g.id, photo_ids: [b.id, a.id] } });
      expect(res.body.data).toEqual({ reordered: true });
      const { rows } = await query(`SELECT id FROM photos WHERE gallery_id = $1 ORDER BY sort_order`, [g.id]);
      expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
    });

    it('refuses an empty list and an unknown gallery', async () => {
      const g = await fixtures.gallery();
      expect((await request('PUT', '/photos/reorder', { body: { gallery_id: g.id, photo_ids: [] } })).status).toBe(400);
      const p = await fixtures.photo(g.id);
      expect(
        (await request('PUT', '/photos/reorder', { body: { gallery_id: MISSING_ID, photo_ids: [p.id] } })).status
      ).toBe(404);
    });
  });

  describe('PUT /photos/move', () => {
    it('moves photos into a gallery and back to Unassigned', async () => {
      const g = await fixtures.gallery();
      const p = await fixtures.photo(null);

      const into = await request('PUT', '/photos/move', { body: { photo_ids: [p.id], target_gallery_id: g.id } });
      expect(into.body.data).toEqual({ moved: 1 });
      expect((await query(`SELECT gallery_id FROM photos WHERE id = $1`, [p.id])).rows[0].gallery_id).toBe(g.id);

      const out = await request('PUT', '/photos/move', { body: { photo_ids: [p.id], target_gallery_id: null } });
      expect(out.body.data).toEqual({ moved: 1 });
      expect((await query(`SELECT gallery_id FROM photos WHERE id = $1`, [p.id])).rows[0].gallery_id).toBeNull();
    });

    it('never unassigns photos when the target is left out', async () => {
      const g = await fixtures.gallery();
      const p = await fixtures.photo(g.id);
      const res = await request('PUT', '/photos/move', { body: { photo_ids: [p.id] } });
      expect(res.status).toBe(400);
      expect((await query(`SELECT gallery_id FROM photos WHERE id = $1`, [p.id])).rows[0].gallery_id).toBe(g.id);
    });

    it('refuses an empty list and an unknown target', async () => {
      const p = await fixtures.photo(null);
      expect((await request('PUT', '/photos/move', { body: { photo_ids: [], target_gallery_id: null } })).status).toBe(400);
      expect(
        (await request('PUT', '/photos/move', { body: { photo_ids: [p.id], target_gallery_id: MISSING_ID } })).status
      ).toBe(404);
    });
  });
});
