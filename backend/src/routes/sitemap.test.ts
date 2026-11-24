import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

vi.mock('../services/sitemapService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/sitemapService')>()),
  getSitemapGallerySlugs: vi.fn(),
}));

const sitemapService = await import('../services/sitemapService');
const { default: app } = await import('../app');

let server: Server;
let base: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/sitemap.xml', () => {
  it('serves XML under FRONTEND_URL, cacheable for a few minutes', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://jacobfain.gallery');
    vi.mocked(sitemapService.getSitemapGallerySlugs).mockResolvedValue(['iceland']);
    const res = await fetch(`${base}/sitemap.xml`);
    vi.unstubAllEnvs();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/xml/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const body = await res.text();
    expect(body).toContain('<loc>https://jacobfain.gallery/g/iceland</loc>');
  });

  it('is never stored when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sitemapService.getSitemapGallerySlugs).mockRejectedValue(new Error('db down'));
    const res = await fetch(`${base}/sitemap.xml`);
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
