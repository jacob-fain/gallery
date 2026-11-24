// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

function tiles() {
  return within(screen.getByRole('group', { name: 'Photo album' })).getAllByRole('button');
}

function lightbox() {
  return screen.getByRole('dialog', { name: 'Lightbox' });
}

function currentSlide() {
  const slide = lightbox().querySelector('.yarl__slide_current');
  if (!slide) throw new Error('no current slide');
  return slide.getAttribute('aria-label');
}

describe('PhotoGrid lightbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens on the tapped photo and records a view of it', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} galleryTitle="Smith Wedding" />);

    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(tiles()[1]);

    expect(currentSlide()).toBe('2 of 3');
    expect(within(lightbox()).getByText('Smith Wedding · 2 / 3')).toBeTruthy();
    expect(client.trackPhotoView).toHaveBeenCalledTimes(1);
    expect(client.trackPhotoView).toHaveBeenCalledWith('b');
  });

  it('moves to the next and previous photo with the arrow keys and records each photo once', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);

    await user.click(tiles()[0]);
    expect(currentSlide()).toBe('1 of 3');

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(currentSlide()).toBe('2 of 3'));
    await waitFor(() => expect(client.trackPhotoView).toHaveBeenLastCalledWith('b'));

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(currentSlide()).toBe('3 of 3'));

    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(currentSlide()).toBe('2 of 3'));

    // Back on b, already counted on this page.
    expect(vi.mocked(client.trackPhotoView).mock.calls).toEqual([['a'], ['b'], ['c']]);
  });

  it('moves with the Next and Previous buttons', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);

    await user.click(tiles()[2]);
    await user.click(within(lightbox()).getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(currentSlide()).toBe('2 of 3'));
    await user.click(within(lightbox()).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentSlide()).toBe('3 of 3'));
  });

  it('closes with the Close button and with Escape, and reopens at the photo tapped next', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);

    await user.click(tiles()[0]);
    await user.click(within(lightbox()).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(tiles()[2]);
    expect(currentSlide()).toBe('3 of 3');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Reopening a photo already counted on this page counts nothing.
    await user.click(tiles()[2]);
    expect(currentSlide()).toBe('3 of 3');
    expect(vi.mocked(client.trackPhotoView).mock.calls).toEqual([['a'], ['c']]);
  });

  it('counts a photo once after a shuffle moves it, and again on the next page view', async () => {
    const user = userEvent.setup();
    const { rerender, unmount } = render(<PhotoGrid photos={photos} />);

    await user.click(tiles()[0]);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Shuffled: a is now last, and c takes its old place.
    rerender(<PhotoGrid photos={[photos[2], photos[1], photos[0]]} />);
    await user.click(tiles()[2]);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(tiles()[0]);
    expect(vi.mocked(client.trackPhotoView).mock.calls).toEqual([['a'], ['c']]);

    unmount();
    render(<PhotoGrid photos={photos} />);
    await user.click(tiles()[0]);
    expect(vi.mocked(client.trackPhotoView).mock.calls).toEqual([['a'], ['c'], ['a']]);
  });

  it("downloads the current photo's original with the gallery's access token", async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    vi.mocked(client.getPhotoDownloadUrl).mockResolvedValue('https://s3.test/b-original.jpg');
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} accessToken="token-1" />);

    await user.click(tiles()[1]);
    await user.click(within(lightbox()).getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://s3.test/b-original.jpg'));
    expect(client.getPhotoDownloadUrl).toHaveBeenCalledWith('b', 'token-1');
  });

  it('downloads a public photo without a token', async () => {
    vi.stubGlobal('location', { assign: vi.fn() });
    vi.mocked(client.getPhotoDownloadUrl).mockResolvedValue('https://s3.test/a-original.jpg');
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);

    await user.click(tiles()[0]);
    await user.click(within(lightbox()).getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(client.getPhotoDownloadUrl).toHaveBeenCalledWith('a', undefined));
  });

  it('stays on the page when the download URL cannot be fetched', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(client.getPhotoDownloadUrl).mockRejectedValue(new Error('Forbidden'));
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} accessToken="expired" />);

    await user.click(tiles()[0]);
    await user.click(within(lightbox()).getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(assign).not.toHaveBeenCalled();
    expect(lightbox()).toBeTruthy();
    consoleError.mockRestore();
  });

  it('reports a failed grid or lightbox image as expired, at most once a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const onImagesExpired = vi.fn();
      const user = userEvent.setup();
      render(<PhotoGrid photos={photos} onImagesExpired={onImagesExpired} />);

      fireEvent.error(screen.getByAltText('Photo 1 of 3'));
      expect(onImagesExpired).toHaveBeenCalledTimes(1);

      // Every other image failing right after is the same expiry.
      fireEvent.error(screen.getByAltText('Photo 2 of 3'));
      expect(onImagesExpired).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 61_000);
      await user.click(tiles()[0]);
      const slideImage = lightbox().querySelector('.yarl__slide_current img');
      if (!slideImage) throw new Error('no slide image');
      fireEvent.error(slideImage);
      expect(onImagesExpired).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores failed images outside the grid and the lightbox', () => {
    const onImagesExpired = vi.fn();
    render(
      <>
        <img alt="logo" src="https://example.test/logo.png" />
        <PhotoGrid photos={photos} onImagesExpired={onImagesExpired} />
      </>
    );

    fireEvent.error(screen.getByAltText('logo'));
    expect(onImagesExpired).not.toHaveBeenCalled();
  });
});
