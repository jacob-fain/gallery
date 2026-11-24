// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicPhoto } from '../types';

vi.mock('../api/client', () => ({
  getGallery: vi.fn(),
  getGalleryPhotos: vi.fn(),
  getGalleryDownloadUrl: vi.fn(),
  getPhotoDownloadUrl: vi.fn(),
  isKnownPrivateGallery: vi.fn(() => true),
  verifyGalleryPassword: vi.fn(),
  trackGalleryView: vi.fn(),
  trackPhotoView: vi.fn(),
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

const locked = { title: 'Smith Wedding', slug: 'smith', is_public: false, requires_password: true } as const;
const access = {
  title: 'Smith Wedding',
  slug: 'smith',
  description: null,
  photoCount: 3,
  is_public: false,
  verified: true,
  accessToken: 'token-1',
} as const;

function renderGallery() {
  render(
    <BrowserRouter>
      <Routes>
        <Route path="/g/:slug" element={<Gallery />} />
      </Routes>
    </BrowserRouter>
  );
}

function currentSlide() {
  return screen
    .getByRole('dialog', { name: 'Lightbox' })
    .querySelector('.yarl__slide_current')
    ?.getAttribute('aria-label');
}

describe('Gallery photo link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.pushState(null, '', '/g/smith?photo=p2');
    vi.mocked(client.getGallery).mockResolvedValue(locked);
    vi.mocked(client.getGalleryPhotos).mockResolvedValue([photo('p1'), photo('p2'), photo('p3')]);
  });

  it('opens the linked photo of a private gallery once it is unlocked', async () => {
    vi.mocked(client.verifyGalleryPassword).mockResolvedValue(access);
    const user = userEvent.setup();
    renderGallery();

    await user.type(await screen.findByPlaceholderText('Enter password'), 'secret{Enter}');

    await screen.findByRole('dialog', { name: 'Lightbox' });
    expect(currentSlide()).toBe('2 of 3');
    expect(window.location.pathname + window.location.search).toBe('/g/smith?photo=p2');
    expect(vi.mocked(client.trackPhotoView).mock.calls).toEqual([['p2']]);
  });

  it('opens the linked photo on a revisit with a stored token', async () => {
    sessionStorage.setItem('gallery_access_smith', 'token-1');
    renderGallery();

    await screen.findByRole('dialog', { name: 'Lightbox' });
    expect(currentSlide()).toBe('2 of 3');
    expect(window.location.href).not.toContain('token-1');
  });
});
