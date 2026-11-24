import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../services/photoService', () => ({
  getPhotoById: vi.fn(),
  setHeroPhoto: vi.fn(),
  getFeaturedPhotosAdmin: vi.fn().mockResolvedValue([]),
  enrichPhotosWithUrls: vi.fn().mockResolvedValue([]),
}));

const photoService = await import('../services/photoService');
const { setHero } = await import('./photoController');

const call = async (body: unknown) => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  await setHero({ body } as Request, res as unknown as Response);
  return res;
};

describe('setHero', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a hidden photo, which visitors would never see as the hero', async () => {
    vi.mocked(photoService.getPhotoById).mockResolvedValue({ id: 'p1', is_hidden: true } as never);
    const res = await call({ photo_id: 'p1' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(photoService.setHeroPhoto).not.toHaveBeenCalled();
  });

  it('sets a visible photo as the hero', async () => {
    vi.mocked(photoService.getPhotoById).mockResolvedValue({ id: 'p1', is_hidden: false } as never);
    const res = await call({ photo_id: 'p1' });
    expect(photoService.setHeroPhoto).toHaveBeenCalledWith('p1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });
});
