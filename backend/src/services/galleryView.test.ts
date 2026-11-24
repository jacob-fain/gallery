import { describe, expect, it } from 'vitest';
import type { Gallery } from '../types';
import { adminGallery, publicGallery, publicGalleryCard, publicGalleryDetail } from './galleryView';

const gallery = (password_hash: string | null): Gallery => ({
  id: 'g1',
  title: 'Wedding',
  slug: 'wedding',
  description: 'Saturday',
  cover_image_id: 'p1',
  is_public: false,
  password_hash,
  access_version: 3,
  view_count: 7,
  created_at: new Date(0),
  updated_at: new Date(0),
});

const cover = {
  coverUrl: 'thumb.webp',
  coverWebUrl: 'web.webp',
  coverWidth: 1200,
  coverHeight: 800,
};

describe('gallery views', () => {
  it('public view carries only what the gallery page renders', () => {
    expect(publicGallery(gallery('$2b$10$hash'))).toEqual({ id: 'g1', title: 'Wedding', slug: 'wedding' });
  });

  it('gallery page view adds only the description and the visible photo count', () => {
    expect(publicGalleryDetail(gallery('$2b$10$hash'), 12)).toEqual({
      id: 'g1',
      title: 'Wedding',
      slug: 'wedding',
      description: 'Saturday',
      photoCount: 12,
    });
    expect(publicGalleryDetail({ ...gallery(null), description: null }, 0)).toMatchObject({
      description: null,
      photoCount: 0,
    });
  });

  it('public card adds only the cover photo', () => {
    expect(publicGalleryCard({ ...gallery(null), ...cover })).toEqual({
      id: 'g1',
      title: 'Wedding',
      slug: 'wedding',
      ...cover,
    });
  });

  it('admin view keeps the full row and says whether a password is set, never the hash', () => {
    const view = adminGallery(gallery('$2b$10$hash'));
    expect(view).toMatchObject({ has_password: true, view_count: 7, cover_image_id: 'p1', is_public: false });
    expect(view).not.toHaveProperty('password_hash');
    expect(view).not.toHaveProperty('access_version');
    expect(adminGallery(gallery(null))).toMatchObject({ has_password: false });
  });
});
