// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  getAllPhotos: vi.fn(async () => []),
  getGallery: vi.fn(async () => ({})),
  getGalleryPhotos: vi.fn(async () => []),
  isKnownPrivateGallery: vi.fn(() => false),
}));

const client = await import('../api/client');
const { galleryTokenKey, startAllPhotosRequest, startGalleryRequests } = await import('./gridRequests');

describe('grid page requests started on route match', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('start a public gallery and its photos', () => {
    startGalleryRequests('smith');
    expect(client.getGallery).toHaveBeenCalledWith('smith');
    expect(client.getGalleryPhotos).toHaveBeenCalledWith('smith');
  });

  it('send a stored access token with the photos request', () => {
    sessionStorage.setItem(galleryTokenKey('smith'), 'token-1');
    startGalleryRequests('smith');
    expect(client.getGalleryPhotos).toHaveBeenCalledWith('smith', 'token-1');
  });

  it('skip the photos of a gallery known to be private without a token', () => {
    vi.mocked(client.isKnownPrivateGallery).mockReturnValueOnce(true);
    startGalleryRequests('smith');
    expect(client.getGallery).toHaveBeenCalledWith('smith');
    expect(client.getGalleryPhotos).not.toHaveBeenCalled();
  });

  it('start nothing for a slug that is not a gallery slug', () => {
    startGalleryRequests('../admin');
    startGalleryRequests(undefined);
    expect(client.getGallery).not.toHaveBeenCalled();
  });

  it('leave a failed request to the page, without an unhandled rejection', async () => {
    vi.mocked(client.getAllPhotos).mockRejectedValueOnce(new Error('offline'));
    startAllPhotosRequest();
    await Promise.resolve();
    expect(client.getAllPhotos).toHaveBeenCalledWith();
  });
});
