import { readFileSync } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import sharp from 'sharp';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { getFileStream } = vi.hoisted(() => ({ getFileStream: vi.fn() }));
vi.mock('../services/s3Service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/s3Service')>()),
  getFileStream,
}));
// The real page, as the frontend container would serve it.
const INDEX = readFileSync(path.join(__dirname, '../../../frontend/index.html'), 'utf8');
vi.mock('../services/indexHtml', () => ({ getIndexHtml: async () => INDEX }));

import { query } from '../config/db';
import { resetCoverCache } from '../services/sharePreview';
import { useAppServer } from '../../test/appServer';
import { tag, useFixtures } from '../../test/fixtures';

const db = process.env.TEST_DATABASE_URL;

const visitor = { admin: false } as const;

/** Every `content` value of the meta tags `attr="key"`. */
const meta = (html: string, attr: 'name' | 'property', key: string): string[] =>
  [...html.matchAll(new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, 'g'))].map((m) => m[1]);

describe.skipIf(!db)('share routes (database)', () => {
  const { request } = useAppServer();
  const fixtures = useFixtures();
  let webp: Buffer;

  beforeAll(async () => {
    webp = await sharp({ create: { width: 1920, height: 1280, channels: 3, background: '#468' } })
      .webp()
      .toBuffer();
  });
  beforeEach(() => {
    resetCoverCache();
    getFileStream.mockReset();
    getFileStream.mockImplementation(async () => Readable.from([webp]));
  });

  const publicGallery = async (title: string, description: string | null) => {
    const g = await fixtures.gallery();
    await query(`UPDATE galleries SET title = $2, description = $3 WHERE id = $1`, [g.id, title, description]);
    const photo = await fixtures.photo(g.id);
    return { ...g, title, photo };
  };

  // A gallery for each way a slug has no preview.
  const withoutPreview = async () => {
    const privateGallery = await fixtures.gallery({ isPublic: false, password: 'secret' });
    const passworded = await fixtures.gallery({ isPublic: true, password: 'secret' });
    const empty = await fixtures.gallery();
    for (const g of [privateGallery, passworded]) {
      await query(`UPDATE galleries SET description = 'Secret description' WHERE id = $1`, [g.id]);
      await fixtures.photo(g.id);
    }
    const hiddenOnly = await fixtures.gallery();
    await fixtures.photo(hiddenOnly.id, { hidden: true });
    return {
      private: privateGallery,
      password: passworded,
      unknown: { slug: `missing-${tag()}`, title: '' },
      empty,
      hiddenOnly,
    };
  };

  describe('GET /api/share/g/:slug', () => {
    it('fills a public gallery into the preview tags', async () => {
      const g = await publicGallery('Iceland & "Friends"', 'Black sand <and> glaciers.');
      const res = await request('GET', `/share/g/${g.slug}`, visitor);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/html/);
      expect(res.headers.get('cache-control')).toBe('no-cache');
      const html = res.raw.toString('utf8');
      expect(html).toContain('<title>Iceland &amp; &quot;Friends&quot; | Jacob Fain Photography</title>');
      expect(meta(html, 'property', 'og:title')).toEqual(['Iceland &amp; &quot;Friends&quot;']);
      expect(meta(html, 'property', 'og:description')).toEqual(['Black sand &lt;and&gt; glaciers.']);
      expect(meta(html, 'property', 'og:url')).toEqual([`https://example.com/g/${g.slug}`]);
      const [image] = meta(html, 'property', 'og:image');
      expect(image).toMatch(new RegExp(`^https://example\\.com/api/share/g/${g.slug}/cover\\.jpg\\?v=[0-9a-f]{12}$`));
      expect(meta(html, 'name', 'twitter:image')).toEqual([image]);

      // The image URL it names is served.
      const cover = await request('GET', new URL(image).pathname.replace(/^\/api/, '') + new URL(image).search, visitor);
      expect(cover.status).toBe(200);
    });

    it('serves the unchanged page for every gallery without a preview', async () => {
      const cases = await withoutPreview();
      for (const name of ['private', 'password', 'unknown'] as const) {
        const res = await request('GET', `/share/g/${cases[name].slug}`, visitor);
        expect(res.status, name).toBe(200);
        expect(res.headers.get('cache-control'), name).toBe('no-cache');
        const html = res.raw.toString('utf8');
        expect(html, name).toBe(INDEX);
        expect(html, name).not.toContain('Secret description');
        if (cases[name].title) expect(html, name).not.toContain(cases[name].title);
      }
    });
  });

  describe('GET /api/share/g/:slug/cover.jpg', () => {
    it('serves a public gallery cover as a cacheable 1200x630 JPEG, rendered once', async () => {
      const g = await publicGallery('Cover', null);
      const first = await request('GET', `/share/g/${g.slug}/cover.jpg`, visitor);
      expect(first.status).toBe(200);
      expect(first.headers.get('content-type')).toBe('image/jpeg');
      expect(first.headers.get('cache-control')).toBe('public, max-age=3600');
      const info = await sharp(first.raw).metadata();
      expect([info.format, info.width, info.height]).toEqual(['jpeg', 1200, 630]);
      expect(getFileStream).toHaveBeenCalledWith(g.photo.s3_web_key);

      const again = await request('GET', `/share/g/${g.slug}/cover.jpg`, visitor);
      expect(again.raw.equals(first.raw)).toBe(true);
      expect(getFileStream).toHaveBeenCalledTimes(1);
    });

    it('answers the same 404 for every gallery without a preview, without touching S3', async () => {
      const cases = await withoutPreview();
      for (const [name, g] of Object.entries(cases)) {
        const res = await request('GET', `/share/g/${g.slug}/cover.jpg`, visitor);
        expect(res.status, name).toBe(404);
        expect(res.headers.get('cache-control'), name).toBe('no-store');
        expect(res.body, name).toEqual({ success: false, error: 'Not found' });
      }
      expect(getFileStream).not.toHaveBeenCalled();
    });
  });
});
