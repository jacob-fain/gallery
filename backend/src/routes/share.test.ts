import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

vi.mock('../services/indexHtml', () => ({ getIndexHtml: vi.fn() }));
vi.mock('../services/sharePreview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/sharePreview')>()),
  getShareGallery: vi.fn(),
  getCoverJpeg: vi.fn(),
}));

const { getIndexHtml } = await import('../services/indexHtml');
const sharePreview = await import('../services/sharePreview');
const { default: app } = await import('../app');

const INDEX = '<html><head><title>Site</title></head><body></body></html>';

let server: Server;
let base: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/share/g`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  vi.mocked(getIndexHtml).mockReset().mockResolvedValue(INDEX);
  vi.mocked(sharePreview.getShareGallery).mockReset();
  vi.mocked(sharePreview.getCoverJpeg).mockReset();
});

describe('GET /api/share/g/:slug', () => {
  it('answers 502 when index.html is unavailable, so nginx serves its own', async () => {
    vi.mocked(getIndexHtml).mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await fetch(`${base}/iceland`);
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(sharePreview.getShareGallery).not.toHaveBeenCalled();
  });

  it('serves the plain page, revalidated, when the database fails', async () => {
    vi.mocked(sharePreview.getShareGallery).mockRejectedValue(new Error('db down'));
    const res = await fetch(`${base}/iceland`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(INDEX);
  });

  it('never looks up a slug the API could not have saved', async () => {
    const res = await fetch(`${base}/Not_A_Slug`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX);
    expect(sharePreview.getShareGallery).not.toHaveBeenCalled();
  });
});

describe('GET /api/share/g/:slug/cover.jpg', () => {
  const gallery = { slug: 'iceland', title: 'Iceland', description: null, coverWebKey: 'web/1' };
  const current = sharePreview.coverVersion('web/1');
  const JPEG = Buffer.from('jpeg bytes');

  beforeEach(() => {
    vi.mocked(sharePreview.getShareGallery).mockResolvedValue(gallery);
    vi.mocked(sharePreview.getCoverJpeg).mockResolvedValue(JPEG);
  });

  it('serves the current cover, cacheable for five minutes at the edge and in browsers', async () => {
    const res = await fetch(`${base}/iceland/cover.jpg?v=${current}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
    expect(Buffer.from(await res.arrayBuffer()).equals(JPEG)).toBe(true);
    expect(sharePreview.getCoverJpeg).toHaveBeenCalledWith('web/1');
  });

  it('is a 404, never stored, for a version that is not the current cover', async () => {
    for (const v of [sharePreview.coverVersion('web/0'), '', 'x'.repeat(12)]) {
      const res = await fetch(`${base}/iceland/cover.jpg?v=${v}`);
      expect(res.status, v).toBe(404);
      expect(res.headers.get('cache-control'), v).toBe('no-store');
      expect(await res.json(), v).toEqual({ success: false, error: 'Not found' });
    }
    expect(sharePreview.getCoverJpeg).not.toHaveBeenCalled();
  });

  it('is a 404 when the version is given more than once', async () => {
    const res = await fetch(`${base}/iceland/cover.jpg?v=${current}&v=${current}`);
    expect(res.status).toBe(404);
    expect(sharePreview.getCoverJpeg).not.toHaveBeenCalled();
  });

  it('redirects a URL with no version to the current one, never stored', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://example.com');
    try {
      const res = await fetch(`${base}/iceland/cover.jpg`, { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`https://example.com/api/share/g/iceland/cover.jpg?v=${current}`);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(sharePreview.getCoverJpeg).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('is the same 404 with or without a version for a gallery with no preview', async () => {
    for (const found of [null, { ...gallery, coverWebKey: null }]) {
      vi.mocked(sharePreview.getShareGallery).mockResolvedValue(found);
      for (const query of ['', `?v=${current}`]) {
        const res = await fetch(`${base}/iceland/cover.jpg${query}`, { redirect: 'manual' });
        expect(res.status, query).toBe(404);
        expect(res.headers.get('cache-control'), query).toBe('no-store');
      }
    }
    expect(sharePreview.getCoverJpeg).not.toHaveBeenCalled();
  });

  it('is a generic 500 when the render fails', async () => {
    vi.mocked(sharePreview.getCoverJpeg).mockRejectedValue(new Error('NoSuchKey'));
    const res = await fetch(`${base}/iceland/cover.jpg?v=${current}`);
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ success: false, error: 'Failed to render cover' });
  });
});
