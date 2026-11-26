// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Gallery, PublicPhoto } from '../types';
import { startsGalleryRun } from './HomeFeatured';

vi.mock('../api/client', () => ({ getFeaturedPhotos: vi.fn(), getGalleries: vi.fn() }));

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

const gallery = (slug: string, title: string, photoCount: number, cover?: [number, number]): Gallery => ({
  id: `g-${slug}`,
  slug,
  title,
  photoCount,
  coverUrl: cover ? `${slug}-thumb.webp` : null,
  coverWebUrl: cover ? `${slug}-web.webp` : null,
  coverWidth: cover?.[0] ?? null,
  coverHeight: cover?.[1] ?? null,
});

const chicago = { title: 'Chicago', slug: 'chicago' };
const soccer = { title: 'Soccer', slug: 'soccer' };

// Out of alphabetical order, to show the homepage keeps the API's order.
const galleries = [
  gallery('people', 'People', 16, [4000, 6000]),
  gallery('soccer', 'Soccer', 1, [6631, 3737]),
  gallery('chicago', 'Chicago', 79),
];

async function renderHome(featured: PublicPhoto[], list: Gallery[] = galleries) {
  vi.mocked(client.getFeaturedPhotos).mockResolvedValue(featured);
  vi.mocked(client.getGalleries).mockResolvedValue(list);
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>
  );
  await screen.findByRole('link', { name: /View all photos/ });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(client.getFeaturedPhotos).mockReset();
  vi.mocked(client.getGalleries).mockReset();
});

const featuredLinks = () => screen.getAllByRole('link', { name: /^Open the/ });
const galleriesSection = () => screen.getByRole('region', { name: 'Galleries' });
const doors = () => within(galleriesSection()).getAllByRole('link');

describe('Home layout', () => {
  it('shows the hero, then Galleries, then Selected Work, then the link to all photos', async () => {
    await renderHome([photo('hero', chicago), photo('a', chicago)]);
    const hero = screen.getByRole('heading', { level: 1, name: 'Jacob Fain' });
    const order = [
      hero,
      screen.getByRole('heading', { name: 'Galleries' }),
      screen.getByRole('heading', { name: 'Selected Work' }),
      screen.getByRole('link', { name: /View all photos/ }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('links the button to All Photos', async () => {
    await renderHome([photo('hero')]);
    expect(screen.getByRole('link', { name: /View all photos/ }).getAttribute('href')).toBe('/photos');
    expect(screen.queryByText(/View all galleries/i)).toBeNull();
  });
});

describe('Galleries', () => {
  it('shows every gallery from the public list, in its order, each linking to its page', async () => {
    await renderHome([photo('hero')]);
    expect(doors().map((d) => d.getAttribute('href'))).toEqual(['/g/people', '/g/soccer', '/g/chicago']);
    const captions = doors().map((d) => Array.from(d.querySelectorAll(':scope > span > span'), (s) => s.textContent));
    expect(captions).toEqual([
      ['People →', '16 photos'],
      ['Soccer →', '1 photo'],
      ['Chicago →', '79 photos'],
    ]);
  });

  it('reserves each cover at its own proportions, so it is shown whole', async () => {
    await renderHome([photo('hero')]);
    const covers = galleriesSection().querySelectorAll('img');
    expect(covers).toHaveLength(2);
    // A portrait cover keeps its portrait box and a wide one its wide box.
    expect([covers[0].getAttribute('width'), covers[0].getAttribute('height')]).toEqual(['1920', '2880']);
    expect([covers[1].getAttribute('width'), covers[1].getAttribute('height')]).toEqual(['1920', '1082']);
    expect(covers[0].getAttribute('srcset')).toBe('people-thumb.webp 600w, people-web.webp 1920w');
    // No text sits over a cover: the caption follows the image.
    const caption = within(doors()[0]).getByText('16 photos');
    expect(covers[0].compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps a placeholder for a gallery with no cover', async () => {
    await renderHome([photo('hero')]);
    expect(within(doors()[2]).queryByRole('img')).toBeNull();
    expect(doors()[2].querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('leaves out galleries with no photos', async () => {
    await renderHome([photo('hero')], [gallery('empty', 'Empty', 0), ...galleries, gallery('new', 'New', 0)]);
    expect(doors().map((d) => d.getAttribute('href'))).toEqual(['/g/people', '/g/soccer', '/g/chicago']);
  });

  it('leaves the section out when every gallery is empty', async () => {
    await renderHome([photo('hero'), photo('a', chicago)], [gallery('empty', 'Empty', 0)]);
    expect(screen.queryByRole('heading', { name: 'Galleries' })).toBeNull();
  });

  it('leaves the section out when there are no galleries', async () => {
    await renderHome([photo('hero'), photo('a', chicago)], []);
    expect(screen.queryByRole('heading', { name: 'Galleries' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Selected Work' })).toBeTruthy();
  });
});

describe('Selected Work', () => {
  it('makes each photo a link to its gallery, around the image', async () => {
    await renderHome([photo('hero', chicago), photo('a', chicago), photo('b', soccer)]);
    const links = featuredLinks();
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/g/chicago', '/g/soccer']);
    expect(screen.getByRole('link', { name: 'Open the Chicago gallery' })).toBe(links[0]);
    expect(within(links[0]).getByAltText('Photo 1 of 2 in Chicago')).toBeTruthy();
  });

  it('shows each photo whole at its own proportions', async () => {
    await renderHome([photo('hero', chicago), photo('a', chicago)]);
    const img = screen.getByAltText('Photo 1 of 1 in Chicago');
    expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['1920', '1280']);
    expect(img.getAttribute('srcset')).toBe('a-thumb.webp 600w, a-web.webp 1920w');
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

  it('is left out when the hero is the only featured photo', async () => {
    await renderHome([photo('hero', chicago)]);
    expect(screen.queryByRole('heading', { name: 'Selected Work' })).toBeNull();
    // The hero and the two covers.
    expect(document.querySelectorAll('img')).toHaveLength(3);
    expect(doors()).toHaveLength(3);
  });

  it('leaves the hero without a photo, and the rest of the page in place, with no featured photos', async () => {
    await renderHome([]);
    expect(screen.getByRole('heading', { level: 1, name: 'Jacob Fain' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Selected Work' })).toBeNull();
    expect(doors()).toHaveLength(3);
  });

  it('shows only the hero and the button with no featured photos and no galleries', async () => {
    await renderHome([], []);
    expect(screen.queryByRole('region')).toBeNull();
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });
});

describe('when a request fails', () => {
  const renderWith = () =>
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );

  it('keeps the hero and Selected Work when the gallery list fails, and retries it in place', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(client.getFeaturedPhotos).mockResolvedValue([photo('hero', chicago), photo('a', chicago)]);
    vi.mocked(client.getGalleries).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(galleries);
    renderWith();

    const section = await screen.findByRole('region', { name: 'Galleries' });
    expect(within(section).getByText("Couldn't load galleries.")).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Selected Work' })).toBeTruthy();
    expect(screen.getByAltText('Photo 1 of 1 in Chicago')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    fireEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(doors()).toHaveLength(3));
    expect(screen.queryByText("Couldn't load galleries.")).toBeNull();
    // Only the failed request is asked again; Selected Work stayed in place.
    expect(client.getFeaturedPhotos).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText('Photo 1 of 1 in Chicago')).toBeTruthy();
  });

  it('keeps the galleries when the featured photos fail, and retries Selected Work in place', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(client.getFeaturedPhotos)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([photo('hero', chicago), photo('a', chicago)]);
    vi.mocked(client.getGalleries).mockResolvedValue(galleries);
    renderWith();

    const section = await screen.findByRole('region', { name: 'Selected Work' });
    expect(within(section).getByText("Couldn't load selected work.")).toBeTruthy();
    expect(doors()).toHaveLength(3);

    fireEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByAltText('Photo 1 of 1 in Chicago')).toBeTruthy();
    expect(screen.queryByText("Couldn't load selected work.")).toBeNull();
    expect(client.getGalleries).toHaveBeenCalledTimes(1);
  });

  it('shows the full-page retry only when both fail, and loads the page on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(client.getFeaturedPhotos).mockRejectedValueOnce(new Error('offline')).mockResolvedValue([photo('hero')]);
    vi.mocked(client.getGalleries).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(galleries);
    renderWith();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Galleries' })).toBeTruthy();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });
});

describe('startsGalleryRun', () => {
  it('is false for a photo with no gallery, even after a gap', () => {
    const photos = [photo('a'), photo('b'), photo('c', soccer), photo('d', soccer)];
    expect(photos.map((_, i) => startsGalleryRun(photos, i))).toEqual([false, false, true, false]);
  });
});
