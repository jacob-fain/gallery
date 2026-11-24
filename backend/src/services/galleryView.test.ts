import { describe, expect, it } from 'vitest';
import type { Gallery } from '../types';
import { adminGallery, publicGallery } from './galleryView';

const gallery = (password_hash: string | null): Gallery & { coverUrl: string } => ({
  id: 'g1',
  title: 'Wedding',
  slug: 'wedding',
  description: null,
  cover_image_id: null,
  is_public: false,
  password_hash,
  view_count: 0,
  created_at: new Date(0),
  updated_at: new Date(0),
  coverUrl: 'cover.webp',
});

describe('gallery views', () => {
  it('public view carries neither the hash nor whether one exists', () => {
    const view = publicGallery(gallery('$2b$10$hash'));
    expect(view).not.toHaveProperty('password_hash');
    expect(view).not.toHaveProperty('has_password');
    expect(view.coverUrl).toBe('cover.webp');
  });

  it('admin view says whether a password is set, never the hash', () => {
    expect(adminGallery(gallery('$2b$10$hash'))).toMatchObject({ has_password: true });
    expect(adminGallery(gallery(null))).toMatchObject({ has_password: false });
    expect(adminGallery(gallery('$2b$10$hash'))).not.toHaveProperty('password_hash');
  });
});
