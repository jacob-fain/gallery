import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../services/photoService', () => ({ movePhotos: vi.fn() }));
vi.mock('../services/galleryService', () => ({ getGalleryById: vi.fn() }));

const photoService = await import('../services/photoService');
const { movePhotos } = await import('./photoController');

const call = async (body: unknown) => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  await movePhotos({ body } as Request, res as unknown as Response);
  return res;
};

describe('movePhotos', () => {
  it.each([[undefined], ['']])('refuses a target of %j instead of unassigning', async (target) => {
    const res = await call({ photo_ids: ['00000000-0000-4000-8000-000000000001'], target_gallery_id: target });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(photoService.movePhotos).not.toHaveBeenCalled();
  });
});
