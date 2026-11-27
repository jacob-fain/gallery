// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicPhoto } from '../types';

vi.mock('../api/client', () => ({
  getAllPhotos: vi.fn(),
  trackPhotoView: vi.fn(),
  getPhotoDownloadUrl: vi.fn(),
  getPhotoOriginal: vi.fn(),
}));

const client = await import('../api/client');
const { default: AllPhotos } = await import('./AllPhotos');
const { default: PhotoGrid } = await import('../components/PhotoGrid/PhotoGrid');
const { ONE_COLUMN_QUERY } = await import('../components/PhotoGrid/gridLayout');

const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
});
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

function photo(i: number, signature = 'old'): PublicPhoto {
  const tall = i % 3 === 1;
  return {
    id: `p${i}`,
    gallery_id: 'g1',
    width: tall ? 2000 : 3000,
    height: tall ? 3000 : 2000,
    exif_data: null,
    webUrl: `https://s3.test/p${i}-web.jpg?sig=${signature}`,
    thumbnailUrl: `https://s3.test/p${i}-thumb.jpg?sig=${signature}`,
  };
}

const photos = Array.from({ length: 12 }, (_, i) => photo(i));

function renderAllPhotos() {
  return render(
    <MemoryRouter initialEntries={['/photos']}>
      <Routes>
        <Route path="/photos" element={<AllPhotos />} />
      </Routes>
    </MemoryRouter>
  );
}

// The photos in the order the page deals them, whatever the layout: each
// tile's alt text names its place ("Photo 3 of 12").
function sequence(): string[] {
  const placed = [...document.querySelectorAll<HTMLImageElement>('img[data-tile]')].map((img) => ({
    place: Number(img.alt.match(/Photo (\d+) of/)![1]),
    id: img.getAttribute('data-src')!.match(/\/(p\d+)-/)![1],
  }));
  return placed.sort((a, b) => a.place - b.place).map((p) => p.id);
}

const apiOrder = photos.map((p) => p.id);

function setOneColumn(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matches && query === ONE_COLUMN_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/photos');
  vi.mocked(client.getAllPhotos).mockResolvedValue(photos);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.matchMedia = originalMatchMedia;
});

describe('the order on All Photos', () => {
  it('is random on a fresh visit, holds every photo once, and differs between fresh visits', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.11);
    const first = renderAllPhotos();
    await screen.findByAltText('Photo 1 of 12');
    const dealt = sequence();
    expect(dealt).not.toEqual(apiOrder);
    expect([...dealt].sort()).toEqual([...apiOrder].sort());
    first.unmount();

    // A new history entry with nothing remembered: a link or the navbar.
    window.history.replaceState(null, '', '/photos');
    sessionStorage.clear();
    random.mockReturnValue(0.73);
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 12');
    expect(sequence()).not.toEqual(dealt);
  });

  it('holds on a return to the same entry (Back to the page, or a reload)', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.11);
    const first = renderAllPhotos();
    await screen.findByAltText('Photo 1 of 12');
    const dealt = sequence();
    first.unmount();

    random.mockReturnValue(0.73);
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 12');
    expect(sequence()).toEqual(dealt);
  });

  it('holds through layout switches, opening and closing a photo, resizes and the tab going away', async () => {
    const user = userEvent.setup();
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 12');
    const dealt = sequence();

    for (const name of ['Collage', 'Single', 'Columns'] as const) {
      await user.click(screen.getByRole('button', { name }));
      expect(sequence()).toEqual(dealt);
    }

    await user.click(screen.getByAltText('Photo 4 of 12'));
    expect(screen.getByRole('dialog', { name: 'Lightbox' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Lightbox' })).toBeNull());
    expect(sequence()).toEqual(dealt);

    act(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('orientationchange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(sequence()).toEqual(dealt);
  });

  it('holds through the expired-URL refresh, even when the list comes back reordered and short', async () => {
    vi.mocked(client.getAllPhotos)
      .mockResolvedValueOnce(photos)
      .mockResolvedValueOnce(
        photos
          .filter((p) => p.id !== 'p5')
          .reverse()
          .map((p, i) => photo(Number(p.id.slice(1)), `new${i}`))
      );
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 12');
    const dealt = sequence();

    fireEvent.error(screen.getByAltText('Photo 1 of 12'));
    await screen.findByAltText('Photo 1 of 11');
    expect(client.getAllPhotos).toHaveBeenLastCalledWith(undefined, { fresh: true });
    expect(sequence()).toEqual(dealt.filter((id) => id !== 'p5'));
  });

  it('holds when a retried load brings back a list in another order', async () => {
    vi.mocked(client.getAllPhotos).mockResolvedValue(photos);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.42);
    const first = renderAllPhotos();
    await screen.findByAltText('Photo 1 of 12');
    const dealt = sequence();
    first.unmount();

    // The same entry loads again (a reload), and the API answers in
    // another order with a photo added.
    vi.mocked(client.getAllPhotos).mockResolvedValue([photo(99), ...[...photos].reverse()]);
    random.mockReturnValue(0.9);
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 13');
    expect(sequence().filter((id) => id !== 'p99')).toEqual(dealt);
  });

  it('changes when Shuffle is pressed', async () => {
    const user = userEvent.setup();
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 12');
    const dealt = sequence();
    await user.click(screen.getByRole('button', { name: 'Shuffle photos' }));
    expect(sequence()).not.toEqual(dealt);
    expect([...sequence()].sort()).toEqual([...apiOrder].sort());
  });
});

describe('the single layout', () => {
  it('is offered beside Columns and Collage, shows one photo per row, and is remembered', async () => {
    const user = userEvent.setup();
    const first = renderAllPhotos();
    await screen.findByAltText('Photo 1 of 12');
    const options = screen.getAllByRole('button', { name: /^(Columns|Collage|Single)$/ });
    expect(options.map((o) => o.textContent)).toEqual(['Columns', 'Collage', 'Single']);

    await user.click(screen.getByRole('button', { name: 'Single' }));
    expect(localStorage.getItem('gridLayout')).toBe('single');
    expect(document.querySelector('.react-photo-album--masonry')).toBeNull();
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-photo-index]')];
    expect(tiles).toHaveLength(12);
    first.unmount();

    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 12');
    expect(screen.getByRole('button', { name: 'Single' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('sizes every image, vertical or not, at the full width of the grid', async () => {
    localStorage.setItem('gridLayout', 'single');
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 12');
    for (const tile of document.querySelectorAll<HTMLElement>('[data-photo-index]')) {
      const img = tile.querySelector('img[data-tile]')!;
      const id = img.getAttribute('data-src')!.match(/\/p(\d+)-/)![1];
      const ratio = Number(id) % 3 === 1 ? 2000 / 3000 : 3000 / 2000;
      expect(tile.style.getPropertyValue('--ratio')).toBe(String(ratio));
      expect(img.getAttribute('sizes')).toBe('(max-width: 640px) calc(100vw - 48px), calc(100vw - 96px)');
      // The shared tile path: held for the scheduler, with no preview.
      expect(img.getAttribute('data-srcset')).toContain(`p${id}-web.jpg`);
      expect(img.previousElementSibling).toBeNull();
    }
  });

  it('is not offered on a one-column grid, where a stored single shows as columns and stays stored', async () => {
    localStorage.setItem('gridLayout', 'single');
    setOneColumn(true);
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 12');
    expect(screen.queryByRole('button', { name: 'Single' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Columns' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.react-photo-album--masonry')).not.toBeNull();
    expect(localStorage.getItem('gridLayout')).toBe('single');
  });
});

describe('the admin Review grid', () => {
  it('keeps the order it is given', () => {
    render(
      <PhotoGrid
        photos={photos}
        layout="single"
        review={{ onSetStatus: () => true, keeps: () => true, toast: null }}
      />
    );
    expect(sequence()).toEqual(apiOrder);
    expect(document.querySelector('.react-photo-album--masonry')).not.toBeNull();
  });
});
