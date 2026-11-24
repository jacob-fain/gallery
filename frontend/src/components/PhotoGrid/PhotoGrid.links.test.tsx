// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicPhoto } from '../../types';

vi.mock('../../api/client', () => ({
  trackPhotoView: vi.fn(),
  getPhotoDownloadUrl: vi.fn(),
}));

const client = await import('../../api/client');
const { default: PhotoGrid } = await import('./PhotoGrid');

// The album lays out nothing until it knows its width, and jsdom has no
// layout, so every element reports a desktop-sized container.
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
});
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

function photo(id: string): PublicPhoto {
  return {
    id,
    gallery_id: 'g1',
    width: 3000,
    height: 2000,
    exif_data: null,
    webUrl: `https://s3.test/${id}-web.jpg`,
    thumbnailUrl: `https://s3.test/${id}-thumb.jpg`,
  };
}

const photos = [photo('a'), photo('b'), photo('c')];

function here() {
  return window.location.pathname + window.location.search;
}

// By attribute rather than role: an open lightbox hides the page from the
// accessibility tree.
function tiles() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-photo-index]'));
}

function lightbox() {
  return screen.getByRole('dialog', { name: 'Lightbox' });
}

function currentSlide() {
  return lightbox().querySelector('.yarl__slide_current')?.getAttribute('aria-label');
}

async function goBack() {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Pushed, not replaced: that drops the entries an earlier test went Back
  // from, so history.length counts only what each test adds.
  window.history.pushState({ page: 'gallery' }, '', '/g/smith');
});

describe('PhotoGrid photo links', () => {
  it('names the open photo in the URL on one history entry, and Back closes it', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);
    const length = window.history.length;

    await user.click(tiles()[0]);
    expect(here()).toBe('/g/smith?photo=a');
    expect(window.history.length).toBe(length + 1);

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(here()).toBe('/g/smith?photo=b'));
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(here()).toBe('/g/smith?photo=c'));
    // Moving between photos rewrites the lightbox's entry.
    expect(window.history.length).toBe(length + 1);

    await goBack();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(here()).toBe('/g/smith');
    expect(window.history.state).toEqual({ page: 'gallery' });
  });

  it('removes the photo from the URL when closed with the Close button', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);

    await user.click(tiles()[1]);
    expect(here()).toBe('/g/smith?photo=b');
    await user.click(within(lightbox()).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(here()).toBe('/g/smith'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a linked photo, with the gallery beneath it for Back, and counts it once', async () => {
    window.history.replaceState({ page: 'gallery' }, '', '/g/smith?photo=b');
    const length = window.history.length;
    render(
      <StrictMode>
        <PhotoGrid photos={photos} />
      </StrictMode>
    );

    expect(currentSlide()).toBe('2 of 3');
    expect(here()).toBe('/g/smith?photo=b');
    expect(window.history.length).toBe(length + 1);
    expect(vi.mocked(client.trackPhotoView).mock.calls).toEqual([['b']]);

    await goBack();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(here()).toBe('/g/smith');
    expect(window.history.state).toEqual({ page: 'gallery' });
    expect(tiles()).toHaveLength(3);
  });

  it('reopens the photo after a reload of its entry without adding another', async () => {
    window.history.replaceState({ page: 'gallery', photoLightbox: true }, '', '/g/smith?photo=c');
    const length = window.history.length;
    render(<PhotoGrid photos={photos} />);

    expect(currentSlide()).toBe('3 of 3');
    expect(window.history.length).toBe(length);
    expect(window.history.state).toEqual({ page: 'gallery', photoLightbox: true });
  });

  it('shows the gallery for a photo that is not in it, and drops the parameter', () => {
    window.history.replaceState({ page: 'gallery' }, '', '/g/smith?photo=gone');
    render(<PhotoGrid photos={photos} />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(here()).toBe('/g/smith');
    expect(client.trackPhotoView).not.toHaveBeenCalled();
  });

  it('reopens the photo on Forward without counting it again', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);

    await user.click(tiles()[2]);
    await goBack();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await act(async () => {
      window.history.forward();
      await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    });
    await waitFor(() => expect(currentSlide()).toBe('3 of 3'));
    expect(here()).toBe('/g/smith?photo=c');
    expect(vi.mocked(client.trackPhotoView).mock.calls).toEqual([['c']]);
  });

  it('keeps an access token out of the URL', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} accessToken="secret-token" />);

    await user.click(tiles()[0]);
    expect(window.location.href).not.toContain('secret-token');
    expect(new URLSearchParams(window.location.search).toString()).toBe('photo=a');
  });
});

// jsdom has no IntersectionObserver. This one reports whether the end of the
// grid is in reach only when a test says so.
class FakeObserver {
  static instances: FakeObserver[] = [];
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }
  observe() {}
  disconnect() {
    FakeObserver.instances = FakeObserver.instances.filter((o) => o !== this);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
  reach() {
    this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function reachEnd() {
  act(() => FakeObserver.instances.at(-1)?.reach());
}

describe('PhotoGrid progressive tiles', () => {
  const many = Array.from({ length: 7 }, (_, i) => photo(`p${i + 1}`));

  beforeEach(() => {
    FakeObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a page of tiles and adds a page each time the end comes into reach', () => {
    render(<PhotoGrid photos={many} tilesPerPage={3} />);
    expect(tiles()).toHaveLength(3);
    // Alt text still counts every photo.
    expect(screen.getByAltText('Photo 3 of 7')).toBeTruthy();

    reachEnd();
    expect(tiles()).toHaveLength(6);
    reachEnd();
    expect(tiles()).toHaveLength(7);
    expect(FakeObserver.instances).toHaveLength(0);
  });

  it('moves the lightbox through every photo, rendered as a tile or not', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={many} tilesPerPage={3} />);

    await user.click(tiles()[2]);
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(currentSlide()).toBe('4 of 7'));
    expect(here()).toBe('/g/smith?photo=p4');
    expect(tiles()).toHaveLength(3);
  });

  it('opens a linked photo beyond the rendered tiles', () => {
    window.history.replaceState({ page: 'gallery' }, '', '/g/smith?photo=p7');
    render(<PhotoGrid photos={many} tilesPerPage={3} />);

    expect(currentSlide()).toBe('7 of 7');
    expect(within(lightbox()).getByText('7 / 7')).toBeTruthy();
    expect(tiles()).toHaveLength(3);
  });

  it('renders as many tiles as the history entry last showed', () => {
    const { unmount } = render(<PhotoGrid photos={many} tilesPerPage={3} tileMemoryKey="entry-1" />);
    reachEnd();
    expect(tiles()).toHaveLength(6);
    unmount();

    render(<PhotoGrid photos={many} tilesPerPage={3} tileMemoryKey="entry-1" />);
    expect(tiles()).toHaveLength(6);
  });

  it('starts a different history entry at one page', () => {
    const { unmount } = render(<PhotoGrid photos={many} tilesPerPage={3} tileMemoryKey="entry-2" />);
    reachEnd();
    unmount();

    render(<PhotoGrid photos={many} tilesPerPage={3} tileMemoryKey="entry-3" />);
    expect(tiles()).toHaveLength(3);
  });

  it('renders every tile without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<PhotoGrid photos={many} tilesPerPage={3} />);
    expect(tiles()).toHaveLength(7);
  });
});
