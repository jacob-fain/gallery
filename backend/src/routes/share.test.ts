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
  it('is a generic 500 when the render fails', async () => {
    vi.mocked(sharePreview.getShareGallery).mockResolvedValue({
      slug: 'iceland',
      title: 'Iceland',
      description: null,
      coverWebKey: 'web/1',
    });
    vi.mocked(sharePreview.getCoverJpeg).mockRejectedValue(new Error('NoSuchKey'));
    const res = await fetch(`${base}/iceland/cover.jpg`);
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ success: false, error: 'Failed to render cover' });
  });
});
