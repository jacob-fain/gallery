import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../services/photoService', () => ({
  deleteRejectedPhotos: vi.fn(),
  countByStatus: vi.fn(),
}));
vi.mock('../services/galleryService', () => ({ getGalleryById: vi.fn() }));
vi.mock('../services/s3Service', () => ({ deleteFiles: vi.fn(async () => 0) }));

const photoService = await import('../services/photoService');
const galleryService = await import('../services/galleryService');
const s3Service = await import('../services/s3Service');
const { deleteRejectedPhotos } = await import('./photoController');

const GALLERY_ID = '11111111-1111-4111-8111-111111111111';
const counts = { review: 1, shown: 2, rejected: 0, all: 3 };

const call = async (gallery: unknown) => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  await deleteRejectedPhotos({ query: { gallery } } as unknown as Request, res as unknown as Response);
  return res;
};

// The database tests cover a gallery's scope. Unassigned and "all" are
// checked here because, in the shared test database, they would delete
// other suites' photos while those run.
describe('deleteRejectedPhotos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(photoService.deleteRejectedPhotos).mockResolvedValue({ deleted: 2, s3Keys: ['a', 'b'] });
    vi.mocked(photoService.countByStatus).mockResolvedValue(counts);
  });

  it.each([
    ['all', { kind: 'all' }],
    ['unassigned', { kind: 'unassigned' }],
    [GALLERY_ID, { kind: 'gallery', id: GALLERY_ID }],
  ])('deletes the rejected photos of gallery=%s, then their files', async (gallery, scope) => {
    vi.mocked(galleryService.getGalleryById).mockResolvedValue({ id: GALLERY_ID } as never);
    const res = await call(gallery);
    expect(photoService.deleteRejectedPhotos).toHaveBeenCalledWith(scope);
    expect(s3Service.deleteFiles).toHaveBeenCalledWith(['a', 'b']);
    expect(photoService.countByStatus).toHaveBeenCalledWith(scope);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { deleted: 2, counts } });
  });

  it('never deletes across galleries when the scope is left out', async () => {
    const res = await call(undefined);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(photoService.deleteRejectedPhotos).not.toHaveBeenCalled();
  });
});
