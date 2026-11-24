import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../services/photoService', async (importOriginal) => ({
  isDuplicateContentError: (await importOriginal<typeof import('../services/photoService')>())
    .isDuplicateContentError,
  getPhotoByContentHash: vi.fn(),
  createPhoto: vi.fn(),
  enrichPhotoWithUrls: vi.fn(async (p: object) => ({ ...p, url: 'signed' })),
}));
vi.mock('../services/galleryService', () => ({ getGalleryById: vi.fn() }));
vi.mock('../services/imageService', () => ({
  isValidImage: vi.fn(async () => true),
  processImage: vi.fn(async () => ({
    original: { buffer: Buffer.from('o'), width: 10, height: 10, size: 1 },
    web: { buffer: Buffer.from('w') },
    thumbnail: { buffer: Buffer.from('t') },
  })),
  extractExifData: vi.fn(async () => null),
}));
vi.mock('../services/s3Service', () => ({
  generatePhotoKeys: () => ({ original: 'k/original', web: 'k/web', thumbnail: 'k/thumb' }),
  uploadFile: vi.fn(async () => {}),
  deleteFiles: vi.fn(async () => 0),
}));

const photoService = await import('../services/photoService');
const s3Service = await import('../services/s3Service');
const { uploadPhoto } = await import('./photoController');

const KEYS = ['k/original', 'k/web', 'k/thumb'];

const call = async () => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const req = { body: {}, file: { buffer: Buffer.from('bytes'), originalname: 'IMG_1.jpg' } };
  await uploadPhoto(req as unknown as Request, res as unknown as Response);
  return res;
};

const uniqueViolation = Object.assign(new Error('duplicate key value'), {
  code: '23505',
  constraint: 'photos_content_hash_key',
});

describe('uploadPhoto cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(photoService.getPhotoByContentHash).mockResolvedValue(null);
    vi.mocked(s3Service.uploadFile).mockResolvedValue(undefined);
  });

  it('keeps the files when the photo is stored', async () => {
    vi.mocked(photoService.createPhoto).mockResolvedValue({ id: 'p1' } as never);
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(s3Service.deleteFiles).not.toHaveBeenCalled();
  });

  it('deletes the uploaded files when the insert fails', async () => {
    vi.mocked(photoService.createPhoto).mockRejectedValue(new Error('connection refused'));
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(s3Service.deleteFiles).toHaveBeenCalledWith(KEYS);
  });

  it('answers a duplicate that lost the insert race with 409 and deletes its files', async () => {
    vi.mocked(photoService.getPhotoByContentHash)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ original_filename: 'first.jpg' } as never);
    vi.mocked(photoService.createPhoto).mockRejectedValue(uniqueViolation);
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Already uploaded as first.jpg' });
    expect(s3Service.deleteFiles).toHaveBeenCalledWith(KEYS);
  });

  it('waits for every upload to settle before deleting when one fails', async () => {
    let finishSlow!: () => void;
    const order: string[] = [];
    vi.mocked(s3Service.uploadFile).mockImplementation(async (_buf, key) => {
      if (key === 'k/web') throw new Error('S3 down');
      if (key === 'k/thumb') {
        await new Promise<void>((resolve) => (finishSlow = resolve));
        order.push('slow upload done');
      }
    });
    vi.mocked(s3Service.deleteFiles).mockImplementation(async () => {
      order.push('delete');
      return 0;
    });

    const pending = call();
    await vi.waitFor(() => expect(finishSlow).toBeTypeOf('function'));
    expect(s3Service.deleteFiles).not.toHaveBeenCalled();
    finishSlow();
    const res = await pending;

    expect(order).toEqual(['slow upload done', 'delete']);
    expect(s3Service.deleteFiles).toHaveBeenCalledWith(KEYS);
    expect(photoService.createPhoto).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
