// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicPhoto } from '../types';

vi.mock('../api/client', () => ({
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
const { default: Gallery } = await import('./Gallery');

// The album lays out nothing until it knows its width, and jsdom has no layout.
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
});
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

function photo(id: string, signature: string): PublicPhoto {
  return {
    id,
    gallery_id: 'g1',
    width: 3000,
    height: 2000,
    exif_data: null,
    webUrl: `https://s3.test/${id}-web.jpg?sig=${signature}`,
    thumbnailUrl: `https://s3.test/${id}-thumb.jpg?sig=${signature}`,
  };
}

const gallery = {
  id: 'g1',
  title: 'Smith Wedding',
  slug: 'smith',
  description: null,
  is_public: true,
} as unknown as Awaited<ReturnType<typeof client.getGallery>>;

function renderGallery() {
  render(
    <MemoryRouter initialEntries={['/g/smith']}>
      <Routes>
        <Route path="/g/:slug" element={<Gallery />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Gallery expired image refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(client.getGallery).mockResolvedValue(gallery);
  });

  it('refetches the photos when an image fails and swaps the new URLs into the same tiles', async () => {
    vi.mocked(client.getGalleryPhotos)
      .mockResolvedValueOnce([photo('a', 'old'), photo('b', 'old')])
      .mockResolvedValueOnce([photo('b', 'new'), photo('a', 'new')]);
    renderGallery();

    const first = await screen.findByAltText('Photo 1 of 2 in Smith Wedding');
    const second = screen.getByAltText('Photo 2 of 2 in Smith Wedding');
    expect(first.getAttribute('src')).toBe('https://s3.test/a-thumb.jpg?sig=old');

    fireEvent.error(first);

    await waitFor(() =>
      expect(first.getAttribute('src')).toBe('https://s3.test/a-thumb.jpg?sig=new')
    );
    expect(client.getGalleryPhotos).toHaveBeenLastCalledWith('smith', undefined, { fresh: true });
    // The grid keeps its order even though the API returned another, and the
    // tiles are the same elements: nothing remounts or reflows.
    expect(screen.getByAltText('Photo 1 of 2 in Smith Wedding')).toBe(first);
    expect(screen.getByAltText('Photo 2 of 2 in Smith Wedding')).toBe(second);
    expect(second.getAttribute('src')).toBe('https://s3.test/b-thumb.jpg?sig=new');
    expect(second.getAttribute('srcset')).toContain('b-web.jpg?sig=new');
  });

  it('refetches a private gallery with its access token', async () => {
    sessionStorage.setItem('gallery_access_smith', 'token-1');
    vi.mocked(client.getGallery).mockResolvedValue({
      title: 'Smith Wedding',
      slug: 'smith',
      is_public: false,
      requires_password: true,
    });
    vi.mocked(client.getGalleryPhotos)
      .mockResolvedValueOnce([photo('a', 'old')])
      .mockResolvedValueOnce([photo('a', 'new')]);
    renderGallery();

    const image = await screen.findByAltText('Photo 1 of 1 in Smith Wedding');
    fireEvent.error(image);

    await waitFor(() =>
      expect(image.getAttribute('src')).toBe('https://s3.test/a-thumb.jpg?sig=new')
    );
    expect(client.getGalleryPhotos).toHaveBeenLastCalledWith('smith', 'token-1', { fresh: true });
  });

  it('keeps the photos already shown when the refresh fails', async () => {
    vi.mocked(client.getGalleryPhotos)
      .mockResolvedValueOnce([photo('a', 'old')])
      .mockRejectedValueOnce(new Error('offline'));
    renderGallery();

    const image = await screen.findByAltText('Photo 1 of 1 in Smith Wedding');
    fireEvent.error(image);

    await waitFor(() => expect(client.getGalleryPhotos).toHaveBeenCalledTimes(2));
    expect(screen.getByAltText('Photo 1 of 1 in Smith Wedding')).toBe(image);
    expect(image.getAttribute('src')).toBe('https://s3.test/a-thumb.jpg?sig=old');
  });
});
