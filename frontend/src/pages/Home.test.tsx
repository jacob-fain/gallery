// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PublicPhoto } from '../types';
import { startsGalleryRun } from './HomeFeatured';

vi.mock('../api/client', () => ({ getFeaturedPhotos: vi.fn() }));

const client = await import('../api/client');
const { default: Home } = await import('./Home');

const photo = (id: string, gallery?: { title: string; slug: string }): PublicPhoto => ({
  id,
  gallery_id: gallery ? `g-${gallery.slug}` : null,
  width: 3000,
  height: 2000,
  exif_data: null,
  webUrl: `${id}-web.webp`,
  thumbnailUrl: `${id}-thumb.webp`,
  gallery_title: gallery?.title ?? null,
  gallery_slug: gallery?.slug ?? null,
});

const chicago = { title: 'Chicago', slug: 'chicago' };
const soccer = { title: 'Soccer', slug: 'soccer' };

async function renderHome(featured: PublicPhoto[]) {
  vi.mocked(client.getFeaturedPhotos).mockResolvedValue(featured);
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>
  );
  return screen.findByText('Selected Work');
}

const featuredLinks = () => screen.getAllByRole('link', { name: /^Open the/ });

describe('Selected Work', () => {
  it('makes each photo a link to its gallery, around the image', async () => {
    await renderHome([photo('hero', chicago), photo('a', chicago), photo('b', soccer)]);
    const links = featuredLinks();
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/g/chicago', '/g/soccer']);
    expect(screen.getByRole('link', { name: 'Open the Chicago gallery' })).toBe(links[0]);
    expect(within(links[0]).getByAltText('Photo 1 of 2 in Chicago')).toBeTruthy();
  });

  it('captions only the first photo of each run from one gallery', async () => {
    await renderHome([
      photo('hero', chicago),
      photo('a', chicago),
      photo('b', chicago),
      photo('c', soccer),
      photo('d', chicago),
    ]);
    const captions = featuredLinks().map((l) => l.textContent?.trim() ?? '');
    expect(captions).toEqual(['Chicago →', '', 'Soccer →', 'Chicago →']);
  });

  it('shows a photo outside any gallery without a link or caption', async () => {
    await renderHome([photo('hero'), photo('loose'), photo('a', soccer)]);
    expect(featuredLinks()).toHaveLength(1);
    expect(screen.getByAltText('Photo 1 of 2').closest('a')).toBeNull();
  });
});

describe('startsGalleryRun', () => {
  it('is false for a photo with no gallery, even after a gap', () => {
    const photos = [photo('a'), photo('b'), photo('c', soccer), photo('d', soccer)];
    expect(photos.map((_, i) => startsGalleryRun(photos, i))).toEqual([false, false, true, false]);
  });
});
