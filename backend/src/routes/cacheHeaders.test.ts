import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import http, { type Server } from 'http';

// Services are stubbed so these run without a database or S3; the headers
// come from app.ts and the handlers, which run for real.
vi.mock('../services/galleryService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/galleryService')>()),
  getPublicGalleriesWithCovers: vi.fn(),
  getGalleryBySlug: vi.fn(),
  getGalleryPhotos: vi.fn(),
  incrementGalleryViews: vi.fn(),
  getGalleryById: vi.fn(),
}));
vi.mock('../services/photoService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/photoService')>()),
  getAllPublicPhotos: vi.fn(),
  getFeaturedPhotos: vi.fn(),
  getPhotoById: vi.fn(),
  incrementPhotoViews: vi.fn(),
  incrementPhotoDownloads: vi.fn(),
  getDownloadUrl: vi.fn(async () => 'https://s3.example/original?sig'),
}));
vi.mock('../services/settingsService', () => ({
  getAllSettings: vi.fn(),
}));
vi.mock('../services/s3Service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/s3Service')>()),
  getSignedUrl: vi.fn(async (key: string) => `https://s3.example/${key}?sig`),
}));

const galleryService = await import('../services/galleryService');
const photoService = await import('../services/photoService');
const settingsService = await import('../services/settingsService');
const { generateGalleryAccessToken } = await import('../services/authService');
const { default: app } = await import('../app');

const PUBLIC = 'public, max-age=60';
const GALLERY_ID = '11111111-1111-4111-8111-111111111111';
const PHOTO_ID = '22222222-2222-4222-8222-222222222222';

const gallery = (is_public: boolean) => ({
  id: GALLERY_ID,
  title: 'Iceland',
  slug: 'iceland',
  description: null,
  cover_image_id: null,
  is_public,
  password_hash: is_public ? null : '$2b$10$hash',
  view_count: 0,
  created_at: new Date(0),
  updated_at: new Date(0),
});

const photo = {
  id: PHOTO_ID,
  gallery_id: GALLERY_ID,
  original_filename: 'DSC_0042.jpg',
  s3_key: 'k/original.jpg',
  s3_web_key: 'k/web.webp',
  s3_thumbnail_key: 'k/thumb.webp',
  width: 100,
  height: 80,
  is_hidden: false,
  featured_order: null,
  content_hash: 'a'.repeat(64),
};

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

beforeEach(() => {
  vi.mocked(galleryService.getPublicGalleriesWithCovers).mockResolvedValue([]);
  vi.mocked(galleryService.getGalleryBySlug).mockResolvedValue(gallery(true));
  vi.mocked(galleryService.getGalleryById).mockResolvedValue(gallery(true));
  vi.mocked(galleryService.getGalleryPhotos).mockResolvedValue([photo as never]);
  vi.mocked(photoService.getAllPublicPhotos).mockResolvedValue([photo as never]);
  vi.mocked(photoService.getFeaturedPhotos).mockResolvedValue([photo as never]);
  vi.mocked(photoService.getPhotoById).mockResolvedValue(photo as never);
  vi.mocked(settingsService.getAllSettings).mockResolvedValue({} as never);
});

const get = async (path: string) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, cache: res.headers.get('cache-control'), etag: res.headers.get('etag'), body: await res.json() };
};

describe('public responses are cached briefly on success', () => {
  it.each(['/galleries', '/galleries/iceland', '/galleries/iceland/photos', '/featured', '/photos', '/settings'])(
    'GET %s',
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.cache).toBe(PUBLIC);
      expect(res.etag).toBeTruthy();
    }
  );

  it('answers a revalidation of an unchanged list with 304', async () => {
    const { etag } = await get('/photos');
    // node:http rather than fetch: fetch adds Cache-Control: no-cache to a
    // conditional request, which tells Express never to answer 304.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      http
        .get(`${base}/photos`, { headers: { 'If-None-Match': etag! } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on('error', reject);
    });
    expect(status).toBe(304);
  });
});

describe('public photo lists carry no internal fields', () => {
  it.each(['/galleries/iceland/photos', '/featured', '/photos'])('GET %s', async (path) => {
    const { body } = await get(path);
    const text = JSON.stringify(body);
    expect(text).not.toContain('original');
    expect(text).not.toContain('s3_');
    expect(text).not.toContain('content_hash');
    expect(body.data[0]).toEqual({
      id: PHOTO_ID,
      gallery_id: GALLERY_ID,
      width: 100,
      height: 80,
      exif_data: null,
      webUrl: 'https://s3.example/k/web.webp?sig',
      thumbnailUrl: 'https://s3.example/k/thumb.webp?sig',
    });
  });

  it('GET /photos/:id returns the same public shape', async () => {
    const { body } = await get(`/photos/${PHOTO_ID}`);
    expect(Object.keys(body.data).sort()).toEqual(
      ['exif_data', 'gallery_id', 'height', 'id', 'thumbnailUrl', 'webUrl', 'width'].sort()
    );
  });
});

describe('responses that must never be stored', () => {
  it('a failed public list', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(galleryService.getPublicGalleriesWithCovers).mockRejectedValue(new Error('db down'));
    const res = await get('/galleries');
    expect(res.status).toBe(500);
    expect(res.cache).toBe('no-store');
  });

  it('a gallery that does not exist', async () => {
    vi.mocked(galleryService.getGalleryBySlug).mockResolvedValue(null);
    const res = await get('/galleries/nope');
    expect(res.status).toBe(404);
    expect(res.cache).toBe('no-store');
  });

  it('a private gallery', async () => {
    vi.mocked(galleryService.getGalleryBySlug).mockResolvedValue(gallery(false));
    expect((await get('/galleries/iceland')).cache).toBe('no-store');
  });

  it('a private gallery refusing photos without a token', async () => {
    vi.mocked(galleryService.getGalleryBySlug).mockResolvedValue(gallery(false));
    const res = await get('/galleries/iceland/photos');
    expect(res.status).toBe(403);
    expect(res.cache).toBe('no-store');
  });

  it('a private gallery photo list unlocked with a token', async () => {
    vi.mocked(galleryService.getGalleryBySlug).mockResolvedValue(gallery(false));
    const token = generateGalleryAccessToken(GALLERY_ID, 'iceland');
    const res = await get(`/galleries/iceland/photos?access=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(res.cache).toBe('no-store');
  });

  it('a single photo, which counts a view', async () => {
    expect((await get(`/photos/${PHOTO_ID}`)).cache).toBe('no-store');
  });

  it('a photo download, which counts a download and signs the original', async () => {
    const res = await get(`/photos/${PHOTO_ID}/download`);
    expect(res.status).toBe(200);
    expect(res.cache).toBe('no-store');
    expect(res.body.data).toEqual({
      filename: 'DSC_0042.jpg',
      downloadUrl: 'https://s3.example/original?sig',
    });
  });

  it.each(['/admin/stats', '/galleries/admin/all', `/galleries/${GALLERY_ID}/photos/admin`, '/photos/admin/unassigned'])(
    'admin GET %s',
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(401);
      expect(res.cache).toBe('no-store');
    }
  );
});
