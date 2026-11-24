import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../services/s3Service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/s3Service')>()),
  getSignedUrl: async (key: string) => `https://signed.example/${key}`,
}));

import { getAllSettings, updateSettings } from '../services/settingsService';
import { useAppServer } from '../../test/appServer';
import { tag, useFixtures } from '../../test/fixtures';

const db = process.env.TEST_DATABASE_URL;

describe.skipIf(!db)('admin dashboard and settings routes (database)', () => {
  const { request } = useAppServer();
  const fixtures = useFixtures();

  describe('settings', () => {
    let original: string;
    afterAll(async () => {
      if (original !== undefined) await updateSettings({ meta_description: original });
    });

    it('serves the settings publicly and cacheably', async () => {
      const res = await request('GET', '/settings', { admin: false });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(expect.objectContaining({ site_title: expect.any(String), meta_description: expect.any(String) }));
      expect(res.headers.get('cache-control')).toContain('public');
    });

    it('saves only the fields sent', async () => {
      const before = await getAllSettings();
      original = before.meta_description;
      // meta_description only: another file checks site_title around a
      // failing batch, and the two may run at once.
      const description = `Described ${tag()}`;

      const res = await request('PUT', '/settings/admin', { body: { meta_description: description } });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ meta_description: description, site_title: before.site_title });
      expect((await request('GET', '/settings', { admin: false })).body.data.meta_description).toBe(description);
    });

    describe('footer links', () => {
      let links: { instagram_url: string; contact_email: string } | undefined;
      afterAll(async () => {
        if (links) await updateSettings(links);
      });

      it('saves, serves and clears the Instagram link and contact email', async () => {
        const { instagram_url, contact_email } = await getAllSettings();
        links = { instagram_url, contact_email };

        const saved = await request('PUT', '/settings/admin', {
          body: { instagram_url: ' https://www.instagram.com/jacobfain ', contact_email: 'hello@jacobfain.com' },
        });
        expect(saved.status).toBe(200);
        expect((await request('GET', '/settings', { admin: false })).body.data).toMatchObject({
          instagram_url: 'https://www.instagram.com/jacobfain',
          contact_email: 'hello@jacobfain.com',
        });

        const cleared = await request('PUT', '/settings/admin', { body: { instagram_url: '', contact_email: '' } });
        expect(cleared.status).toBe(200);
        expect(cleared.body.data).toMatchObject({ instagram_url: '', contact_email: '' });
      });

      it('refuses an invalid link and saves nothing from that request', async () => {
        const before = await getAllSettings();

        const res = await request('PUT', '/settings/admin', {
          body: { instagram_url: 'https://example.com/jacobfain', contact_email: 'hello@jacobfain.com' },
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Instagram link must be an https://instagram.com address');

        const bad = await request('PUT', '/settings/admin', { body: { contact_email: 'nope' } });
        expect(bad.status).toBe(400);
        expect(bad.body.error).toBe('Contact email must be a valid email address');

        const after = await getAllSettings();
        expect(after.instagram_url).toBe(before.instagram_url);
        expect(after.contact_email).toBe(before.contact_email);
      });
    });

    it('needs the admin session to save', async () => {
      const res = await request('PUT', '/settings/admin', { session: false, body: { meta_description: 'x' } });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /admin/stats', () => {
    it('counts galleries by visibility and photos', async () => {
      const g = await fixtures.gallery({ isPublic: false, password: 'pw' });
      await fixtures.photo(g.id);

      const res = await request('GET', '/admin/stats');
      expect(res.status).toBe(200);
      const { galleries, photos, views, downloads } = res.body.data;
      expect(galleries.private).toBeGreaterThanOrEqual(1);
      expect(galleries.total).toBe(galleries.public + galleries.private);
      expect(photos.total).toBeGreaterThanOrEqual(1);
      expect(typeof views.galleries).toBe('number');
      expect(typeof views.photos).toBe('number');
      expect(typeof downloads).toBe('number');
    });
  });

  describe('GET /admin/analytics', () => {
    it('sends every chart, with signed thumbnails for the top photos', async () => {
      await fixtures.photo(null);

      const res = await request('GET', '/admin/analytics');
      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(Object.keys(data).sort()).toEqual(['storage', 'topGalleries', 'topPhotos', 'uploadActivity', 'viewsOverTime']);
      expect(data.viewsOverTime).toHaveLength(30);
      expect(data.topPhotos.length).toBeGreaterThanOrEqual(1);
      for (const p of data.topPhotos) {
        expect(p.thumbnailUrl).toBe(`https://signed.example/${p.thumbnail_key}`);
      }
    });

    it('needs the admin session', async () => {
      expect((await request('GET', '/admin/analytics', { session: false })).status).toBe(401);
    });
  });
});
