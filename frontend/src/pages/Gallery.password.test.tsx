// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import type { PublicPhoto } from '../types';

vi.mock('../api/client', () => ({
  getGallery: vi.fn(),
  getGalleryPhotos: vi.fn(),
  getGalleryDownloadUrl: vi.fn(async () => '/download'),
  isKnownPrivateGallery: vi.fn(() => true),
  verifyGalleryPassword: vi.fn(),
  trackGalleryView: vi.fn(),
}));
// The real grid needs layout measurements that jsdom cannot provide.
vi.mock('../components/PhotoGrid/PhotoGrid', () => ({
  default: ({ photos }: { photos: PublicPhoto[] }) => (
    <>
      <p>{photos.length} photos shown</p>
      <img alt="First photo" />
    </>
  ),
}));

const client = await import('../api/client');
const { default: Gallery } = await import('./Gallery');

const locked = { title: 'Smith Wedding', slug: 'smith', is_public: false, requires_password: true } as const;
const access = {
  title: 'Smith Wedding',
  slug: 'smith',
  description: null,
  photoCount: 2,
  is_public: false,
  verified: true,
  accessToken: 'token-1',
} as const;
const photos = [{ id: 'p1' }, { id: 'p2' }] as PublicPhoto[];

function renderGallery() {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/gallery/smith']}>
      <Routes>
        <Route path="/gallery/:slug" element={<Gallery />} />
      </Routes>
    </MemoryRouter>
  );
  return user;
}

describe('Gallery password screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(client.getGallery).mockResolvedValue(locked);
  });

  it('asks for the password and keeps the button off until one is typed', async () => {
    const user = renderGallery();

    const input = await screen.findByPlaceholderText('Enter password');
    const button = screen.getByRole('button', { name: 'View Gallery' }) as HTMLButtonElement;
    expect(screen.getByRole('heading', { name: 'Smith Wedding' })).toBeTruthy();
    expect(button.disabled).toBe(true);

    await user.type(input, '   ');
    expect(button.disabled).toBe(true);
    await user.type(input, 'x');
    expect(button.disabled).toBe(false);
    // A private gallery's photos are not requested before it is unlocked.
    expect(client.getGalleryPhotos).not.toHaveBeenCalled();
  });

  it('shows the API message for a wrong password and stays locked', async () => {
    vi.mocked(client.verifyGalleryPassword).mockRejectedValue(
      new ApiError('Request failed', 401, 'Incorrect password')
    );
    const user = renderGallery();

    await user.type(await screen.findByPlaceholderText('Enter password'), 'wrong{Enter}');

    expect(await screen.findByText('Incorrect password')).toBeTruthy();
    expect(screen.getByPlaceholderText('Enter password')).toBeTruthy();
    expect(sessionStorage.getItem('gallery_access_smith')).toBeNull();
  });

  it('falls back to a generic message when the request fails without one', async () => {
    vi.mocked(client.verifyGalleryPassword).mockRejectedValue(new TypeError('Failed to fetch'));
    const user = renderGallery();

    await user.type(await screen.findByPlaceholderText('Enter password'), 'pw{Enter}');

    expect(
      await screen.findByText('The password could not be checked. Please try again.')
    ).toBeTruthy();
  });

  it('unlocks with the right password, keeps the token for the session, and shows the photos', async () => {
    vi.mocked(client.verifyGalleryPassword).mockResolvedValue(access);
    vi.mocked(client.getGalleryPhotos).mockResolvedValue(photos);
    const user = renderGallery();

    await user.type(await screen.findByPlaceholderText('Enter password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'View Gallery' }));

    expect(await screen.findByText('2 photos shown')).toBeTruthy();
    expect(client.verifyGalleryPassword).toHaveBeenCalledWith('smith', 'secret');
    expect(client.getGalleryPhotos).toHaveBeenCalledWith('smith', 'token-1');
    expect(sessionStorage.getItem('gallery_access_smith')).toBe('token-1');
    expect(screen.queryByPlaceholderText('Enter password')).toBeNull();
  });

  it("downloads the ZIP through the URL the client builds from the gallery's token", async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    vi.mocked(client.verifyGalleryPassword).mockResolvedValue(access);
    vi.mocked(client.getGalleryPhotos).mockResolvedValue(photos);
    vi.mocked(client.getGalleryDownloadUrl).mockResolvedValue('/api/galleries/smith/download?ticket=t1');
    const user = renderGallery();

    await user.type(await screen.findByPlaceholderText('Enter password'), 'secret{Enter}');
    // The floating buttons wait for the first photo to load.
    fireEvent.load(await screen.findByAltText('First photo'));
    await user.click(await screen.findByRole('button', { name: 'Download all photos as ZIP' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/galleries/smith/download?ticket=t1'));
    expect(client.getGalleryDownloadUrl).toHaveBeenCalledWith('smith', 'token-1');
    vi.unstubAllGlobals();
  });

  it('stays on the page when the ZIP cannot be started', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    sessionStorage.setItem('gallery_access_smith', 'token-1');
    vi.mocked(client.getGalleryPhotos).mockResolvedValue(photos);
    vi.mocked(client.getGalleryDownloadUrl).mockRejectedValue(new ApiError('Forbidden', 403));
    const user = renderGallery();

    fireEvent.load(await screen.findByAltText('First photo'));
    await user.click(await screen.findByRole('button', { name: 'Download all photos as ZIP' }));

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText('2 photos shown')).toBeTruthy();
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });

  it('skips the password screen on a revisit with a stored token', async () => {
    sessionStorage.setItem('gallery_access_smith', 'token-1');
    vi.mocked(client.getGalleryPhotos).mockResolvedValue(photos);

    renderGallery();

    expect(await screen.findByText('2 photos shown')).toBeTruthy();
    expect(client.verifyGalleryPassword).not.toHaveBeenCalled();
  });

  it('drops a stored token the API refuses and asks for the password again', async () => {
    sessionStorage.setItem('gallery_access_smith', 'expired');
    vi.mocked(client.getGalleryPhotos).mockRejectedValue(new ApiError('Forbidden', 403));

    renderGallery();

    expect(await screen.findByPlaceholderText('Enter password')).toBeTruthy();
    expect(sessionStorage.getItem('gallery_access_smith')).toBeNull();
  });
});
