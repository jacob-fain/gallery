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
import { generateGalleryAccessToken } from '../services/authService';
import { drainTracking } from '../services/eventTracking';
import { useAppServer, type RequestOptions } from '../../test/appServer';
import { tag, useFixtures } from '../../test/fixtures';

const db = process.env.TEST_DATABASE_URL;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

const visitor = (access?: string): RequestOptions => ({
  admin: false,
  headers: access ? { 'X-Gallery-Access': access } : {},
});

describe.skipIf(!db)('gallery routes (database)', () => {
  const { request } = useAppServer();
  const fixtures = useFixtures();

  beforeEach(() => {
    deleteFiles.mockReset();
    deleteFiles.mockResolvedValue(0);
  });

  describe('admin session', () => {
    it.each([
      ['GET', '/galleries/admin/all'],
      ['POST', '/galleries'],
      ['PUT', `/galleries/${MISSING_ID}`],
      ['DELETE', `/galleries/${MISSING_ID}`],
      ['PUT', '/galleries/reorder'],
      ['GET', `/galleries/${MISSING_ID}/photos/admin`],
      ['GET', '/admin/stats'],
    ])('%s %s needs one', async (method, path) => {
      const res = await request(method, path, { session: false, body: method === 'GET' ? undefined : {} });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /galleries', () => {
    it('creates a gallery and never returns its password hash', async () => {
      const slug = `created-${tag()}`;
      const res = await request('POST', '/galleries', {
        body: { title: 'Created', slug, is_public: false, password: 'pw' },
      });
      expect(res.status).toBe(201);
      fixtures.adopt(res.body.data.id);
      expect(res.body.data).toMatchObject({ title: 'Created', slug, is_public: false, has_password: true });
      expect(res.body.data).not.toHaveProperty('password_hash');
    });

    it.each([
      [{ slug: 'no-title' }, 400, 'Title and slug are required'],
      [{ title: 'T', slug: 'Bad Slug' }, 400, 'Slug must be lowercase'],
      [{ title: 'T', slug: 'trailing-' }, 400, 'Slug must be lowercase'],
      [{ title: 'T', slug: `private-${tag()}`, is_public: false }, 400, 'A private gallery needs a password'],
    ])('refuses %j', async (body, status, error) => {
      const res = await request('POST', '/galleries', { body });
      expect(res.status).toBe(status);
      expect(res.body.error).toContain(error);
    });

    it('refuses a slug already in use', async () => {
      const existing = await fixtures.gallery();
      const res = await request('POST', '/galleries', { body: { title: 'Again', slug: existing.slug } });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('A gallery with this slug already exists');
    });
  });

  describe('gallery lists', () => {
    it('shows the admin every gallery, and visitors only the public ones', async () => {
      const pub = await fixtures.gallery();
      const priv = await fixtures.gallery({ isPublic: false, password: 'pw' });

      const admin = await request('GET', '/galleries/admin/all');
      expect(admin.status).toBe(200);
      const adminRows = admin.body.data.filter((g: { id: string }) => [pub.id, priv.id].includes(g.id));
      expect(adminRows).toHaveLength(2);
      expect(adminRows.find((g: { id: string }) => g.id === priv.id)).toMatchObject({ has_password: true });

      const visitor = await request('GET', '/galleries', { admin: false });
      expect(visitor.status).toBe(200);
      const ids = visitor.body.data.map((g: { id: string }) => g.id);
      expect(ids).toContain(pub.id);
      expect(ids).not.toContain(priv.id);
      // A visitor's card carries only what the page renders.
      expect(Object.keys(visitor.body.data.find((g: { id: string }) => g.id === pub.id)).sort()).toEqual(
        ['coverHeight', 'coverUrl', 'coverWebUrl', 'coverWidth', 'id', 'slug', 'title']
      );
    });
  });

  describe('GET /galleries/:slug', () => {
    it('answers a public gallery with its id, title and slug, cacheable', async () => {
      const g = await fixtures.gallery();
      const res = await request('GET', `/galleries/${g.slug}`, { admin: false });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ id: g.id, title: g.title, slug: g.slug });
      expect(res.headers.get('cache-control')).toContain('public');
    });

    it('answers a private gallery with only its title and a password prompt', async () => {
      const g = await fixtures.gallery({ isPublic: false, password: 'pw' });
      const res = await request('GET', `/galleries/${g.slug}`, { admin: false });
      expect(res.body.data).toEqual({ title: g.title, slug: g.slug, is_public: false, requires_password: true });
    });

    it('answers 404 for an unknown slug', async () => {
      const res = await request('GET', `/galleries/no-such-${tag()}`, { admin: false });
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /galleries/:id', () => {
    it('renames a gallery and moves its slug', async () => {
      const g = await fixtures.gallery();
      const slug = `renamed-${tag()}`;
      const res = await request('PUT', `/galleries/${g.id}`, { body: { title: 'Renamed', slug } });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: g.id, title: 'Renamed', slug });
      expect((await request('GET', `/galleries/${slug}`, { admin: false })).status).toBe(200);
    });

    it('keeps a stored password when none is sent, and refuses to remove the only one', async () => {
      const g = await fixtures.gallery({ isPublic: false, password: 'pw' });

      const kept = await request('PUT', `/galleries/${g.id}`, { body: { title: 'Still private' } });
      expect(kept.body.data).toMatchObject({ is_public: false, has_password: true });

      const removed = await request('PUT', `/galleries/${g.id}`, { body: { password: null } });
      expect(removed.status).toBe(400);
      expect(removed.body.error).toBe('A private gallery needs a password');
    });

    it('refuses a bad or taken slug', async () => {
      const g = await fixtures.gallery();
      const other = await fixtures.gallery();
      expect((await request('PUT', `/galleries/${g.id}`, { body: { slug: 'Nope!' } })).status).toBe(400);
      expect((await request('PUT', `/galleries/${g.id}`, { body: { slug: other.slug } })).status).toBe(409);
    });

    it('answers 404 for an unknown or malformed id', async () => {
      expect((await request('PUT', `/galleries/${MISSING_ID}`, { body: { title: 'x' } })).status).toBe(404);
      expect((await request('PUT', '/galleries/not-a-uuid', { body: { title: 'x' } })).status).toBe(404);
    });
  });

  describe('private gallery access', () => {
    it('trades the right password for a token that opens the photos', async () => {
      const g = await fixtures.gallery({ isPublic: false, password: 'secret' });
      await fixtures.photo(g.id);

      const locked = await request('GET', `/galleries/${g.slug}/photos`, { admin: false });
      expect(locked.status).toBe(403);

      const wrong = await request('POST', `/galleries/${g.slug}/verify`, { admin: false, body: { password: 'guess' } });
      expect(wrong.status).toBe(401);

      const right = await request('POST', `/galleries/${g.slug}/verify`, { admin: false, body: { password: 'secret' } });
      expect(right.status).toBe(200);
      expect(right.body.data).toMatchObject({ title: g.title, slug: g.slug, verified: true });

      const open = await request('GET', `/galleries/${g.slug}/photos`, visitor(right.body.data.accessToken));
      expect(open.status).toBe(200);
      expect(open.body.data).toHaveLength(1);
      // Photos behind a password are for one visitor, never a shared cache.
      expect(open.headers.get('cache-control')).not.toContain('public');
    });

    // A token in a URL reaches nginx's error log, so no route reads one there.
    it('refuses a token sent as ?access=', async () => {
      const g = await fixtures.gallery({ isPublic: false, password: 'pw' });
      const p = await fixtures.photo(g.id);
      const access = encodeURIComponent(generateGalleryAccessToken(g.id, g.slug, 0));
      const status = async (method: string, path: string) => (await request(method, path, { admin: false })).status;
      expect({
        list: await status('GET', `/galleries/${g.slug}/photos?access=${access}`),
        photo: await status('GET', `/photos/${p.id}?access=${access}`),
        download: await status('GET', `/photos/${p.id}/download?access=${access}`),
        ticket: await status('POST', `/galleries/${g.slug}/download-ticket?access=${access}`),
        zip: await status('GET', `/galleries/${g.slug}/download?access=${access}`),
      }).toEqual({ list: 403, photo: 404, download: 404, ticket: 403, zip: 403 });

      const before = (await query(`SELECT view_count FROM galleries WHERE id = $1`, [g.id])).rows[0].view_count;
      await request('POST', `/galleries/${g.slug}/view?access=${access}`, { admin: false });
      await drainTracking();
      expect((await query(`SELECT view_count FROM galleries WHERE id = $1`, [g.id])).rows[0].view_count).toBe(before);
    });

    it("refuses another gallery's token", async () => {
      const g = await fixtures.gallery({ isPublic: false, password: 'pw' });
      const other = await fixtures.gallery({ isPublic: false, password: 'pw' });
      const token = generateGalleryAccessToken(other.id, other.slug, 0);
      const res = await request('GET', `/galleries/${g.slug}/photos`, visitor(token));
      expect(res.status).toBe(403);
    });

    it.each([
      ['no password', 'public', {}, 400, 'Password is required'],
      ['a public gallery', 'public', { password: 'pw' }, 400, 'This gallery is public and does not require a password'],
      ['an unknown slug', 'missing', { password: 'pw' }, 404, 'Gallery not found'],
    ])('verify refuses %s', async (_label, kind, body, status, error) => {
      const slug = kind === 'public' ? (await fixtures.gallery()).slug : `no-such-${tag()}`;
      const res = await request('POST', `/galleries/${slug}/verify`, { admin: false, body });
      expect(res.status).toBe(status);
      expect(res.body.error).toBe(error);
    });
  });

  describe('access token revocation', () => {
    const unlock = async (slug: string, password: string) => {
      const res = await request('POST', `/galleries/${slug}/verify`, { admin: false, body: { password } });
      expect(res.status).toBe(200);
      return res.body.data.accessToken as string;
    };

    const viewCount = async (id: string) =>
      (await query(`SELECT view_count FROM galleries WHERE id = $1`, [id])).rows[0].view_count as number;

    // Every route that takes the token: the photo list, one photo, its
    // download, the ZIP ticket, and view tracking (which answers the same
    // either way, so its effect is read from the counter).
    const uses = async (g: { id: string; slug: string }, photoId: string, access: string) => {
      const before = await viewCount(g.id);
      await request('POST', `/galleries/${g.slug}/view`, visitor(access));
      await drainTracking();
      const ticket = await request('POST', `/galleries/${g.slug}/download-ticket`, visitor(access));
      return {
        list: (await request('GET', `/galleries/${g.slug}/photos`, visitor(access))).status,
        photo: (await request('GET', `/photos/${photoId}`, visitor(access))).status,
        download: (await request('GET', `/photos/${photoId}/download`, visitor(access))).status,
        ticket: ticket.status,
        zip: (await request('GET', `/galleries/${g.slug}/download?ticket=${ticket.body.data?.ticket ?? ''}`, visitor()))
          .status,
        viewCounted: (await viewCount(g.id)) > before,
      };
    };
    const works = { list: 200, photo: 200, download: 200, ticket: 200, zip: 200, viewCounted: true };
    const refused = { list: 403, photo: 404, download: 404, ticket: 403, zip: 403, viewCounted: false };

    it('a password change revokes tokens issued before it', async () => {
      const g = await fixtures.gallery({ isPublic: false, password: 'old' });
      const p = await fixtures.photo(g.id);
      const access = await unlock(g.slug, 'old');
      expect(await uses(g, p.id, access)).toEqual(works);

      expect((await request('PUT', `/galleries/${g.id}`, { body: { password: 'new' } })).status).toBe(200);
      expect(await uses(g, p.id, access)).toEqual(refused);
      expect(await uses(g, p.id, await unlock(g.slug, 'new'))).toEqual(works);
    });

    it('setting the same password again still revokes', async () => {
      const g = await fixtures.gallery({ isPublic: false, password: 'same' });
      const p = await fixtures.photo(g.id);
      const access = await unlock(g.slug, 'same');

      expect((await request('PUT', `/galleries/${g.id}`, { body: { password: 'same' } })).status).toBe(200);
      expect(await uses(g, p.id, access)).toEqual(refused);
    });

    it('removing the password revokes, even once it is private again with the same one', async () => {
      const g = await fixtures.gallery({ isPublic: false, password: 'secret' });
      const p = await fixtures.photo(g.id);
      const access = await unlock(g.slug, 'secret');

      const opened = await request('PUT', `/galleries/${g.id}`, { body: { is_public: true, password: null } });
      expect(opened.status).toBe(200);
      expect(opened.body.data.has_password).toBe(false);
      const closed = await request('PUT', `/galleries/${g.id}`, { body: { is_public: false, password: 'secret' } });
      expect(closed.status).toBe(200);
      expect(await uses(g, p.id, access)).toEqual(refused);
    });

    it('going public and back to private revokes, with the stored password kept', async () => {
      const g = await fixtures.gallery({ isPublic: false, password: 'secret' });
      const p = await fixtures.photo(g.id);
      const access = await unlock(g.slug, 'secret');

      expect((await request('PUT', `/galleries/${g.id}`, { body: { is_public: true } })).status).toBe(200);
      expect((await request('PUT', `/galleries/${g.id}`, { body: { is_public: false } })).status).toBe(200);
      expect(await uses(g, p.id, access)).toEqual(refused);
    });

    it('an unrelated edit keeps tokens working', async () => {
      const g = await fixtures.gallery({ isPublic: false, password: 'secret' });
      const p = await fixtures.photo(g.id);
      const access = await unlock(g.slug, 'secret');

      const edited = await request('PUT', `/galleries/${g.id}`, {
        body: { title: 'Renamed', description: 'New words', is_public: false },
      });
      expect(edited.status).toBe(200);
      expect(await uses(g, p.id, access)).toEqual(works);
    });
  });

  describe('public gallery photos', () => {
    it('lists visible photos only, with signed URLs and no storage keys', async () => {
      const g = await fixtures.gallery();
      const shown = await fixtures.photo(g.id);
      await fixtures.photo(g.id, { hidden: true });

      const res = await request('GET', `/galleries/${g.slug}/photos`, { admin: false });
      expect(res.status).toBe(200);
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([shown.id]);
      expect(res.body.data[0].thumbnailUrl).toBe(`https://signed.example/${shown.s3_thumbnail_key}`);
      expect(JSON.stringify(res.body.data)).not.toContain('s3_key');
    });
  });

  describe('GET /galleries/:id/photos/admin', () => {
    it('includes hidden photos and pages with total and nextOffset', async () => {
      const g = await fixtures.gallery();
      await fixtures.photo(g.id);
      await fixtures.photo(g.id, { hidden: true });

      const all = await request('GET', `/galleries/${g.id}/photos/admin`);
      expect(all.body.data).toHaveLength(2);
      expect(all.body).toMatchObject({ total: 2, nextOffset: null });

      const first = await request('GET', `/galleries/${g.id}/photos/admin?limit=1`);
      expect(first.body.data).toHaveLength(1);
      expect(first.body).toMatchObject({ total: 2, nextOffset: 1 });
    });

    it('refuses a bad page and answers 404 for an unknown gallery', async () => {
      const g = await fixtures.gallery();
      expect((await request('GET', `/galleries/${g.id}/photos/admin?limit=0`)).status).toBe(400);
      expect((await request('GET', `/galleries/${MISSING_ID}/photos/admin`)).status).toBe(404);
    });
  });

  describe('PUT /galleries/:id/cover', () => {
    it('sets a photo of the gallery as its cover, and clears it', async () => {
      const g = await fixtures.gallery();
      const p = await fixtures.photo(g.id);

      const set = await request('PUT', `/galleries/${g.id}/cover`, { body: { photoId: p.id } });
      expect(set.body.data.cover_image_id).toBe(p.id);

      const cleared = await request('PUT', `/galleries/${g.id}/cover`, { body: { photoId: null } });
      expect(cleared.body.data.cover_image_id).toBeNull();
    });

    it("refuses another gallery's photo", async () => {
      const g = await fixtures.gallery();
      const elsewhere = await fixtures.photo((await fixtures.gallery()).id);
      const res = await request('PUT', `/galleries/${g.id}/cover`, { body: { photoId: elsewhere.id } });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /galleries/reorder', () => {
    it('stores the order it is given', async () => {
      const a = await fixtures.gallery();
      const b = await fixtures.gallery();

      const res = await request('PUT', '/galleries/reorder', { body: { gallery_ids: [b.id, a.id] } });
      expect(res.body.data).toEqual({ reordered: true });
      const { rows } = await query(
        `SELECT id FROM galleries WHERE id = ANY($1) ORDER BY sort_order`,
        [[a.id, b.id]]
      );
      expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
    });

    it('refuses an empty list', async () => {
      expect((await request('PUT', '/galleries/reorder', { body: { gallery_ids: [] } })).status).toBe(400);
    });
  });

  describe('DELETE /galleries/:id', () => {
    it('removes the gallery with its photos, then their files', async () => {
      const g = await fixtures.gallery();
      const p = await fixtures.photo(g.id);

      const res = await request('DELETE', `/galleries/${g.id}`);
      expect(res.body.data).toEqual({ deleted: true });
      expect(deleteFiles).toHaveBeenCalledOnce();
      expect(deleteFiles.mock.calls[0][0]).toEqual(
        expect.arrayContaining([p.s3_key, p.s3_web_key, p.s3_thumbnail_key])
      );
      expect((await query(`SELECT 1 FROM photos WHERE id = $1`, [p.id])).rowCount).toBe(0);

      expect((await request('DELETE', `/galleries/${g.id}`)).status).toBe(404);
    });
  });

  describe('GET /galleries/:slug/download', () => {
    it('streams a public gallery as a ZIP of its originals', async () => {
      const g = await fixtures.gallery();
      const p = await fixtures.photo(g.id);

      const res = await request('GET', `/galleries/${g.slug}/download`, { admin: false });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
      expect(res.headers.get('content-disposition')).toContain(`${g.slug}.zip`);
      // A ZIP starts with a local file header, and stored entries keep their bytes.
      expect(res.raw.subarray(0, 4).toString('hex')).toBe('504b0304');
      expect(res.raw.includes(Buffer.from(p.s3_key))).toBe(true);
    });

    it('refuses an empty gallery and a private one without a ticket', async () => {
      const empty = await fixtures.gallery();
      expect((await request('GET', `/galleries/${empty.slug}/download`, { admin: false })).status).toBe(400);

      const priv = await fixtures.gallery({ isPublic: false, password: 'pw' });
      await fixtures.photo(priv.id);
      const res = await request('GET', `/galleries/${priv.slug}/download`, { admin: false });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Password required to download this gallery');
    });
  });

  describe('POST /galleries/:slug/download-ticket', () => {
    const ticketFor = async (slug: string, access?: string) =>
      request('POST', `/galleries/${slug}/download-ticket`, visitor(access));
    const zip = async (slug: string, ticket: string) =>
      request('GET', `/galleries/${slug}/download?ticket=${encodeURIComponent(ticket)}`, visitor());

    const privateGallery = async () => {
      const g = await fixtures.gallery({ isPublic: false, password: 'pw' });
      const p = await fixtures.photo(g.id);
      return { g, p, token: generateGalleryAccessToken(g.id, g.slug, 0) };
    };

    it('trades the access header for a ticket that opens the ZIP once', async () => {
      const { g, p, token } = await privateGallery();
      const res = await ticketFor(g.slug, token);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const { ticket } = res.body.data;
      expect(ticket).toMatch(/^[\w-]{43}$/);
      expect(ticket).not.toContain(token);

      const first = await zip(g.slug, ticket);
      expect(first.status).toBe(200);
      expect(first.headers.get('content-type')).toBe('application/zip');
      expect(first.raw.includes(Buffer.from(p.s3_key))).toBe(true);

      const again = await zip(g.slug, ticket);
      expect(again.status).toBe(403);
      expect(again.body.error).toBe('This download link has expired. Please try the download again.');
    });

    it('needs a token that unlocks the gallery', async () => {
      const { g } = await privateGallery();
      const other = await fixtures.gallery({ isPublic: false, password: 'pw' });
      expect((await ticketFor(g.slug)).status).toBe(403);
      expect((await ticketFor(g.slug, 'not-a-token')).status).toBe(403);
      expect((await ticketFor(g.slug, generateGalleryAccessToken(other.id, other.slug, 0))).status).toBe(403);
      expect((await ticketFor(`no-such-${tag()}`, 'x')).status).toBe(404);
    });

    it("refuses a ticket for another gallery's ZIP, and spends it", async () => {
      const a = await privateGallery();
      const b = await privateGallery();
      const ticket = (await ticketFor(a.g.slug, a.token)).body.data.ticket;
      expect((await zip(b.g.slug, ticket)).status).toBe(403);
      expect((await zip(a.g.slug, ticket)).status).toBe(403);
    });

    it('a password change between ticket and download revokes the ticket', async () => {
      const { g, token } = await privateGallery();
      const ticket = (await ticketFor(g.slug, token)).body.data.ticket;
      expect((await request('PUT', `/galleries/${g.id}`, { body: { password: 'new' } })).status).toBe(200);
      expect((await zip(g.slug, ticket)).status).toBe(403);
    });

    it('a ticket stops working after 60 seconds', async () => {
      const { g, token } = await privateGallery();
      const ticket = (await ticketFor(g.slug, token)).body.data.ticket;
      const issued = Date.now();
      const now = vi.spyOn(Date, 'now').mockReturnValue(issued + 60_000);
      try {
        expect((await zip(g.slug, ticket)).status).toBe(403);
      } finally {
        now.mockRestore();
      }
    });

    it('answers null for a public gallery, whose ZIP needs no ticket', async () => {
      const g = await fixtures.gallery();
      await fixtures.photo(g.id);
      const res = await ticketFor(g.slug);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ ticket: null });
      expect((await request('GET', `/galleries/${g.slug}/download`, visitor())).status).toBe(200);
    });
  });
});
