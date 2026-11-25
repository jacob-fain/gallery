import { describe, expect, it, vi } from 'vitest';
import type { Photo } from '../types';

vi.mock('./s3Service', () => ({
  getSignedUrl: vi.fn(async (key: string) => `https://s3.example/${key}?sig`),
}));

const { getSignedUrl } = await import('./s3Service');
const { publicPhoto, toPublicPhotos } = await import('./photoView');

const row: Photo = {
  id: 'p1',
  gallery_id: 'g1',
  filename: 'p1.jpg',
  original_filename: 'DSC_0042.jpg',
  s3_key: 'galleries/g1/p1/original.jpg',
  s3_thumbnail_key: 'galleries/g1/p1/thumb.webp',
  s3_web_key: 'galleries/g1/p1/web.webp',
  width: 6000,
  height: 4000,
  file_size: 12345678,
  sort_order: 3,
  is_featured: false,
  is_hidden: false,
  review_status: 'shown',
  featured_order: 2,
  view_count: 10,
  download_count: 4,
  uploaded_at: new Date(0),
  exif_data: { cameraModel: 'X100V', iso: 200 },
  content_hash: 'a'.repeat(64),
};

const urls = { webUrl: 'web', thumbnailUrl: 'thumb' };

describe('publicPhoto', () => {
  it('carries exactly the fields the public pages render', () => {
    expect(publicPhoto(row, urls)).toEqual({
      id: 'p1',
      gallery_id: 'g1',
      width: 6000,
      height: 4000,
      exif_data: { cameraModel: 'X100V', iso: 200 },
      webUrl: 'web',
      thumbnailUrl: 'thumb',
    });
  });

  it('never carries keys, the hash, filenames, counters, ordering, or flags', () => {
    const view = publicPhoto(row, urls) as unknown as Record<string, unknown>;
    for (const field of [
      's3_key',
      's3_web_key',
      's3_thumbnail_key',
      'content_hash',
      'filename',
      'original_filename',
      'file_size',
      'view_count',
      'download_count',
      'sort_order',
      'featured_order',
      'is_featured',
      'is_hidden',
      'review_status',
      'uploaded_at',
      'url',
    ]) {
      expect(view).not.toHaveProperty(field);
    }
    expect(JSON.stringify(view)).not.toContain('galleries/g1');
  });

  it('keeps the gallery the featured query joined in', () => {
    const featured = { ...row, gallery_title: 'Iceland', gallery_slug: 'iceland' };
    expect(publicPhoto(featured, urls)).toMatchObject({ gallery_title: 'Iceland', gallery_slug: 'iceland' });
  });

  it('keeps a joined gallery of null for an unassigned featured photo', () => {
    const featured = { ...row, gallery_id: null, gallery_title: null, gallery_slug: null };
    expect(publicPhoto(featured, urls)).toMatchObject({ gallery_title: null, gallery_slug: null });
  });

  it('sends null when a photo has no EXIF', () => {
    expect(publicPhoto({ ...row, exif_data: undefined }, urls).exif_data).toBeNull();
  });
});

describe('toPublicPhotos', () => {
  it('signs the web and thumbnail sizes and never the original', async () => {
    const [photo] = await toPublicPhotos([row]);
    expect(photo.webUrl).toBe('https://s3.example/galleries/g1/p1/web.webp?sig');
    expect(photo.thumbnailUrl).toBe('https://s3.example/galleries/g1/p1/thumb.webp?sig');
    const signedKeys = vi.mocked(getSignedUrl).mock.calls.map(([key]) => key);
    expect(signedKeys).not.toContain(row.s3_key);
  });
});
