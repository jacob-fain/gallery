import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../services/photoService', () => ({
  getPhotoById: vi.fn(),
  setHeroPhoto: vi.fn(),
  reorderFeaturedPhotos: vi.fn(),
  getFeaturedPhotosAdmin: vi.fn().mockResolvedValue([]),
  enrichPhotosWithUrls: vi.fn().mockResolvedValue([]),
}));

const photoService = await import('../services/photoService');
const { setHero, reorderFeatured } = await import('./photoController');

type Handler = (req: Request, res: Response) => Promise<unknown>;
const call = async (body: unknown, handler: Handler = setHero) => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  await handler({ body } as Request, res as unknown as Response);
  return res;
};

describe('setHero', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['review', 'rejected'])('refuses a %s photo, which visitors would never see as the hero', async (status) => {
    vi.mocked(photoService.getPhotoById).mockResolvedValue({ id: 'p1', review_status: status } as never);
    const res = await call({ photo_id: 'p1' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(photoService.setHeroPhoto).not.toHaveBeenCalled();
  });

  it('sets a shown photo as the hero', async () => {
    vi.mocked(photoService.getPhotoById).mockResolvedValue({ id: 'p1', review_status: 'shown' } as never);
    const res = await call({ photo_id: 'p1' });
    expect(photoService.setHeroPhoto).toHaveBeenCalledWith('p1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });
});

describe('reorderFeatured', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to move a photo that is not shown into the hero position', async () => {
    vi.mocked(photoService.getPhotoById).mockResolvedValue({
      id: 'b',
      review_status: 'review',
      featured_order: 1,
    } as never);
    const res = await call({ photo_ids: ['b', 'a'] }, reorderFeatured);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(photoService.reorderFeaturedPhotos).not.toHaveBeenCalled();
  });

  it('lets a hero that was rejected afterwards keep its place', async () => {
    vi.mocked(photoService.getPhotoById).mockResolvedValue({
      id: 'a',
      review_status: 'rejected',
      featured_order: 0,
    } as never);
    await call({ photo_ids: ['a', 'c', 'b'] }, reorderFeatured);
    expect(photoService.reorderFeaturedPhotos).toHaveBeenCalledWith(['a', 'c', 'b']);
  });
});
