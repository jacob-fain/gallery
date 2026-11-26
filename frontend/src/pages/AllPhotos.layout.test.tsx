// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicPhoto } from '../types';

vi.mock('../api/client', () => ({
  getAllPhotos: vi.fn(),
  getGallery: vi.fn(),
  getGalleryPhotos: vi.fn(),
  getGalleryDownloadUrl: vi.fn(async () => '/download'),
  isKnownPrivateGallery: vi.fn(() => false),
  verifyGalleryPassword: vi.fn(),
  trackGalleryView: vi.fn(),
  trackPhotoView: vi.fn(),
  getPhotoDownloadUrl: vi.fn(),
}));

const client = await import('../api/client');
const { default: AllPhotos } = await import('./AllPhotos');
const { default: Gallery } = await import('./Gallery');
const { default: PhotoGrid } = await import('../components/PhotoGrid/PhotoGrid');

// jsdom has no layout, so every element reports a desktop-sized container.
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
});
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

const SHAPES: [number, number][] = [
  [3000, 2000],
  [2000, 3000],
  [4000, 3000],
  [1920, 1080],
  [1080, 1920],
  [3000, 2000],
];

function photo(i: number): PublicPhoto {
  const [width, height] = SHAPES[i % SHAPES.length];
  return {
    id: `p${i}`,
    gallery_id: 'g1',
    width,
    height,
    exif_data: null,
    webUrl: `https://s3.test/p${i}-web.jpg`,
    thumbnailUrl: `https://s3.test/p${i}-thumb.jpg`,
  };
}

const photos = Array.from({ length: 24 }, (_, i) => photo(i));

function renderAllPhotos() {
  return render(
    <MemoryRouter initialEntries={['/photos']}>
      <Routes>
        <Route path="/photos" element={<AllPhotos />} />
      </Routes>
    </MemoryRouter>
  );
}

function tiles() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-photo-index]'));
}

// Each tile's photo and its box, which together are the arrangement.
function arrangement() {
  return tiles().map((tile) => {
    const img = tile.querySelector('img[data-tile]')!;
    return `${img.getAttribute('data-src')} ${tile.style.left} ${tile.style.top} ${tile.style.width} ${tile.style.height}`;
  });
}

function option(name: 'Columns' | 'Collage') {
  return screen.getByRole('button', { name });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/photos');
  vi.mocked(client.getAllPhotos).mockResolvedValue(photos);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the grid layout switch', () => {
  it('starts on columns, the masonry', async () => {
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 24');
    expect(option('Columns').getAttribute('aria-pressed')).toBe('true');
    expect(option('Collage').getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.react-photo-album--masonry')).not.toBeNull();
  });

  it('switches to the collage and remembers it in this browser', async () => {
    const user = userEvent.setup();
    const first = renderAllPhotos();
    await screen.findByAltText('Photo 1 of 24');
    await user.click(option('Collage'));

    expect(option('Collage').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.react-photo-album--masonry')).toBeNull();
    expect(tiles()).toHaveLength(24);
    expect(localStorage.getItem('gridLayout')).toBe('collage');

    first.unmount();
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 24');
    expect(option('Collage').getAttribute('aria-pressed')).toBe('true');

    await user.click(option('Columns'));
    expect(localStorage.getItem('gridLayout')).toBe('columns');
    expect(document.querySelector('.react-photo-album--masonry')).not.toBeNull();
  });

  it('works when the browser refuses storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const user = userEvent.setup();
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 24');
    expect(option('Columns').getAttribute('aria-pressed')).toBe('true');
    await user.click(option('Collage'));
    expect(option('Collage').getAttribute('aria-pressed')).toBe('true');
    expect(tiles()).toHaveLength(24);
  });
});

describe('the collage on All Photos', () => {
  beforeEach(() => {
    localStorage.setItem('gridLayout', 'collage');
  });

  it('shows each photo uncropped, with a sizes attribute of its own width', async () => {
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 24');
    // The grid's scheduler starts the collage's images too.
    const first = screen.getByAltText('Photo 1 of 24');
    await waitFor(() => expect(first.getAttribute('srcset')).toContain('https://s3.test/p0-web.jpg'));
    for (const tile of tiles()) {
      const index = Number(tile.dataset.photoIndex);
      const [w, h] = SHAPES[index % SHAPES.length];
      const width = parseFloat(tile.style.width);
      const height = parseFloat(tile.style.height);
      expect(Math.abs(width / (w / h) - height)).toBeLessThan(0.5);
      const img = tile.querySelector('img[data-tile]')!;
      expect(img.getAttribute('sizes')).toBe(`${Math.ceil(width)}px`);
      // Held for the scheduler (tileScheduler.ts), behind a preview.
      expect(img.getAttribute('data-srcset')).toContain(`https://s3.test/p${index}-web.jpg`);
      expect(img.previousElementSibling?.getAttribute('data-src')).toBe(`https://s3.test/p${index}-thumb.jpg`);
    }
  });

  it('opens the lightbox on the tile clicked, and Back keeps the arrangement', async () => {
    const user = userEvent.setup();
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 24');
    const before = arrangement();

    await user.click(tiles()[5]);
    expect(window.location.search).toBe('?photo=p5');
    expect(screen.getByRole('dialog', { name: 'Lightbox' })).toBeTruthy();

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Lightbox' })).toBeNull());
    expect(arrangement()).toEqual(before);
  });

  it('deals the same order and collage again on a return to the page, and Shuffle deals new ones', async () => {
    const user = userEvent.setup();
    const first = renderAllPhotos();
    await screen.findByAltText('Photo 1 of 24');
    await user.click(screen.getByRole('button', { name: 'Shuffle photos' }));
    const shuffled = arrangement();
    first.unmount();

    // The same history entry: Back to the page, or a reload.
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 24');
    expect(arrangement()).toEqual(shuffled);

    await user.click(screen.getByRole('button', { name: 'Shuffle photos' }));
    expect(arrangement()).not.toEqual(shuffled);
  });

  it('deals a new collage on a fresh visit', async () => {
    // Fixed seeds, so the two visits can't draw the same arrangement by chance.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.11);
    const first = renderAllPhotos();
    await screen.findByAltText('Photo 1 of 24');
    const before = arrangement();
    first.unmount();

    // A new history entry has nothing remembered.
    window.history.replaceState(null, '', '/photos');
    sessionStorage.clear();
    random.mockReturnValue(0.73);
    renderAllPhotos();
    await screen.findByAltText('Photo 1 of 24');
    expect(arrangement()).not.toEqual(before);
    random.mockRestore();
  });
});

describe('the collage on a gallery page', () => {
  const gallery = {
    id: 'g1',
    title: 'Smith Wedding',
    slug: 'smith',
    description: null,
    is_public: true,
  } as unknown as Awaited<ReturnType<typeof client.getGallery>>;

  function renderGallery() {
    return render(
      <MemoryRouter initialEntries={['/g/smith']}>
        <Routes>
          <Route path="/g/:slug" element={<Gallery />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('keeps the gallery order and the same arrangement on every visit', async () => {
    vi.mocked(client.getGallery).mockResolvedValue(gallery);
    vi.mocked(client.getGalleryPhotos).mockResolvedValue(photos);
    localStorage.setItem('gridLayout', 'collage');
    const first = renderGallery();
    // The page's buttons wait for a photo to show.
    fireEvent.load(await screen.findByAltText('Photo 1 of 24 in Smith Wedding'));
    expect(screen.getByRole('button', { name: 'Collage' }).getAttribute('aria-pressed')).toBe('true');
    const before = arrangement();
    expect(tiles().map((t) => Number(t.dataset.photoIndex))).toEqual(photos.map((_, i) => i));
    first.unmount();

    sessionStorage.clear();
    renderGallery();
    await screen.findByAltText('Photo 1 of 24 in Smith Wedding');
    expect(arrangement()).toEqual(before);
  });
});

describe('the admin Review grid', () => {
  it('stays on columns', () => {
    render(
      <PhotoGrid
        photos={photos}
        layout="collage"
        review={{ onSetStatus: () => true, keeps: () => true, toast: null }}
      />
    );
    expect(document.querySelector('.react-photo-album--masonry')).not.toBeNull();
    expect(screen.queryByRole('group', { name: 'Layout' })).toBeNull();
  });
});

describe('the collage grid', () => {
  it('renders whole bands, page by page', () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    try {
      const many = Array.from({ length: 100 }, (_, i) => photo(i));
      render(<PhotoGrid photos={many} layout="collage" collageSeed={3} tilesPerPage={10} />);
      const shown = tiles().length;
      expect(shown).toBeGreaterThanOrEqual(10);
      expect(shown).toBeLessThan(20);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lays out again on a resize, moving the same images', async () => {
    let resized: () => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    let width = 1200;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
    try {
      render(<PhotoGrid photos={photos} layout="collage" collageSeed={3} />);
      const images = tiles().map((tile) => tile.querySelector('img[data-tile]'));
      const before = arrangement();
      width = 700;
      act(() => resized());
      // Debounced: nothing moves until the width settles.
      expect(arrangement()).toEqual(before);
      await waitFor(() => expect(arrangement()).not.toEqual(before));
      const right = Math.max(...tiles().map((t) => parseFloat(t.style.left) + parseFloat(t.style.width)));
      expect(right).toBeCloseTo(700, 6);
      tiles().forEach((tile, i) => expect(tile.querySelector('img[data-tile]')).toBe(images[i]));
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
    }
  });
});
