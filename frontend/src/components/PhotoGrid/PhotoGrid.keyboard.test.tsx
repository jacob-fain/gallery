// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicPhoto } from '../../types';

vi.mock('../../api/client', () => ({
  trackPhotoView: vi.fn(),
  getPhotoDownloadUrl: vi.fn(),
}));

const { default: PhotoGrid } = await import('./PhotoGrid');

// The album lays out nothing until it knows its width, and jsdom has no
// layout, so every element reports a desktop-sized container (three columns).
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

function tile(n: number, total = photos.length) {
  const button = screen.getByAltText(`Photo ${n} of ${total}`).closest('button');
  if (!button) throw new Error(`no tile for photo ${n}`);
  return button;
}

function lightbox() {
  return screen.getByRole('dialog', { name: 'Lightbox' });
}

function control(name: string) {
  return within(lightbox()).getByRole('button', { name });
}

function focusedLabel() {
  const active = document.activeElement;
  return (
    active?.getAttribute('aria-label') ??
    active?.querySelector('img')?.alt ??
    (active?.textContent || active?.tagName)
  );
}

async function openWithKeyboard(user: ReturnType<typeof userEvent.setup>, n: number) {
  tile(n).focus();
  await user.keyboard('{Enter}');
  expect(lightbox()).toBeTruthy();
}

// Zoom in stays disabled here: jsdom never loads the slide's image, so there
// is nothing to zoom.
const CONTROLS = ['Download', 'Close', 'Previous', 'Next'];

describe('PhotoGrid keyboard and history', () => {
  beforeEach(() => {
    // A test that ends with the lightbox open leaves its photo in the URL.
    window.history.replaceState({ page: 'gallery' }, '', '/g/smith');
  });

  it('keeps Tab and Shift+Tab cycling through the open lightbox controls', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);
    await openWithKeyboard(user, 1);

    const seen: (string | undefined)[] = [];
    for (let i = 0; i < CONTROLS.length * 2; i += 1) {
      await user.tab();
      seen.push(focusedLabel());
    }
    expect(seen).toEqual([...CONTROLS, ...CONTROLS]);

    await user.tab({ shift: true });
    expect(focusedLabel()).toBe('Previous');
    control('Download').focus();
    await user.tab({ shift: true });
    expect(focusedLabel()).toBe('Next');
    expect(lightbox().contains(document.activeElement)).toBe(true);
  });

  it.each(CONTROLS)('closes with Escape from %s and returns focus to the opening tile', async (name) => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);
    await openWithKeyboard(user, 2);

    control(name).focus();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(tile(2));
  });

  it('closes with Escape when focus has left the lightbox', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);
    await openWithKeyboard(user, 3);

    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(tile(3));
  });

  it('closes on Back and leaves the gallery entry current', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);

    await user.click(tile(1));
    expect(window.history.state).toEqual({ page: 'gallery', photoLightbox: true });
    expect(window.location.pathname + window.location.search).toBe('/g/smith?photo=a');

    window.history.back();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.history.state).toEqual({ page: 'gallery' });
    expect(window.location.pathname + window.location.search).toBe('/g/smith');
  });

  it('pops its history entry when closed with the Close button or Escape', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);
    const popped = vi.fn();
    window.addEventListener('popstate', popped);
    try {
      await user.click(tile(1));
      await user.click(control('Close'));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(popped).toHaveBeenCalledTimes(1));
      expect(window.history.state).toEqual({ page: 'gallery' });

      await user.click(tile(2));
      expect(window.history.state).toEqual({ page: 'gallery', photoLightbox: true });
      await user.keyboard('{Escape}');
      await waitFor(() => expect(popped).toHaveBeenCalledTimes(2));
      expect(window.history.state).toEqual({ page: 'gallery' });
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      window.removeEventListener('popstate', popped);
    }
  });

  it('opens the gallery normally after a reload on the lightbox entry', () => {
    window.history.replaceState({ page: 'gallery', photoLightbox: true }, '');
    render(<PhotoGrid photos={photos} />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.history.state).toEqual({ page: 'gallery' });
  });

  it('tabs through the tiles in reading order, then past the album', async () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(photo);
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before</button>
        <PhotoGrid photos={six} />
        <button type="button">After</button>
      </>
    );

    // Three equal columns hold photos 1 and 4, 2 and 5, 3 and 6.
    const domOrder = within(screen.getByRole('group', { name: 'Photo album' }))
      .getAllByRole('img')
      .map((img) => img.getAttribute('alt'));
    expect(domOrder).toEqual([1, 4, 2, 5, 3, 6].map((n) => `Photo ${n} of 6`));

    screen.getByRole('button', { name: 'Before' }).focus();
    const forward: (string | undefined)[] = [];
    for (let i = 0; i < 7; i += 1) {
      await user.tab();
      forward.push(focusedLabel());
    }
    expect(forward).toEqual([...[1, 2, 3, 4, 5, 6].map((n) => `Photo ${n} of 6`), 'After']);

    const backward: (string | undefined)[] = [];
    for (let i = 0; i < 7; i += 1) {
      await user.tab({ shift: true });
      backward.push(focusedLabel());
    }
    expect(backward).toEqual([...[6, 5, 4, 3, 2, 1].map((n) => `Photo ${n} of 6`), 'Before']);
  });
});
