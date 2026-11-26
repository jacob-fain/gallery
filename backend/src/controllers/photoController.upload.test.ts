import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { HEIC_NOT_SUPPORTED } from '../config/upload';

vi.mock('../services/photoService', async (importOriginal) => ({
  isDuplicateContentError: (await importOriginal<typeof import('../services/photoService')>())
    .isDuplicateContentError,
  getPhotoByContentHash: vi.fn(),
  createPhoto: vi.fn(),
  enrichPhotoWithUrls: vi.fn(async (p: object) => ({ ...p, url: 'signed' })),
}));
vi.mock('../services/galleryService', () => ({ getGalleryById: vi.fn() }));
vi.mock('../services/imageService', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/imageService')>();
  const png = { contentType: 'image/png', extension: 'png', extensions: ['png'] };
  return {
    UnsupportedImageError: real.UnsupportedImageError,
    HeicNotSupportedError: real.HeicNotSupportedError,
    ImageTooLargeError: real.ImageTooLargeError,
    readImageInfo: vi.fn(async () => ({ format: png, width: 10, height: 10, metadata: {} })),
    processImage: vi.fn(async () => ({
      original: { buffer: Buffer.from('o'), width: 10, height: 10, size: 1, format: png },
      web: { buffer: Buffer.from('w') },
      thumbnail: { buffer: Buffer.from('t') },
    })),
    exifFromMetadata: vi.fn(() => null),
  };
});
vi.mock('../services/s3Service', () => ({
  generatePhotoKeys: vi.fn(() => ({ original: 'k/original', web: 'k/web', thumbnail: 'k/thumb' })),
  uploadFile: vi.fn(async () => {}),
  deleteFiles: vi.fn(async () => 0),
}));

const photoService = await import('../services/photoService');
const s3Service = await import('../services/s3Service');
const imageService = await import('../services/imageService');
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
      .mockResolvedValueOnce({ id: 'p0', gallery_id: 'g1', original_filename: 'first.jpg', review_status: 'shown' } as never);
    vi.mocked(photoService.createPhoto).mockRejectedValue(uniqueViolation);
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Already uploaded as first.jpg (shown)',
      existing: { id: 'p0', gallery_id: 'g1' },
    });
    expect(s3Service.deleteFiles).toHaveBeenCalledWith(KEYS);
  });

  it.each([
    ['rejected', 'rejected'],
    ['review', 'needs review'],
  ])('names the state of a %s duplicate', async (status, name) => {
    vi.mocked(photoService.getPhotoByContentHash).mockResolvedValue({
      id: 'p0',
      gallery_id: null,
      original_filename: 'first.jpg',
      review_status: status,
    } as never);
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: `Already uploaded as first.jpg (${name})`,
      existing: { id: 'p0', gallery_id: null },
    });
    expect(photoService.createPhoto).not.toHaveBeenCalled();
  });

  it('answers a duplicate whose stored row is gone with no photo named', async () => {
    vi.mocked(photoService.getPhotoByContentHash).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    vi.mocked(photoService.createPhoto).mockRejectedValue(uniqueViolation);
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Already uploaded' });
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

describe('uploadPhoto format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(photoService.getPhotoByContentHash).mockResolvedValue(null);
    vi.mocked(s3Service.uploadFile).mockResolvedValue(undefined);
    vi.mocked(photoService.createPhoto).mockResolvedValue({ id: 'p1' } as never);
  });

  it('stores the original under the type and extension sharp read from the bytes', async () => {
    // The request names the file IMG_1.jpg; the bytes are PNG.
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(s3Service.generatePhotoKeys).toHaveBeenCalledWith(null, expect.any(String), 'png');
    expect(s3Service.uploadFile).toHaveBeenCalledWith(Buffer.from('o'), 'k/original', 'image/png');
    expect(photoService.createPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ original_content_type: 'image/png', original_filename: 'IMG_1.jpg' })
    );
  });

  it('answers 415 for bytes that are not a supported image, before storing anything', async () => {
    vi.mocked(imageService.readImageInfo).mockRejectedValueOnce(
      new imageService.UnsupportedImageError('gif')
    );
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(415);
    expect(imageService.processImage).not.toHaveBeenCalled();
    expect(s3Service.uploadFile).not.toHaveBeenCalled();
  });

  it('answers 415 with how to export a JPEG for HEIC bytes under another name, before storing anything', async () => {
    vi.mocked(imageService.readImageInfo).mockRejectedValueOnce(new imageService.HeicNotSupportedError());
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: HEIC_NOT_SUPPORTED });
    expect(imageService.processImage).not.toHaveBeenCalled();
    expect(s3Service.uploadFile).not.toHaveBeenCalled();
  });

  it('answers 413 for an image over the pixel limit, before decoding it', async () => {
    vi.mocked(imageService.readImageInfo).mockRejectedValueOnce(
      new imageService.ImageTooLargeError('Image is larger than 120 megapixels')
    );
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Image is larger than 120 megapixels' });
    expect(imageService.processImage).not.toHaveBeenCalled();
  });
});
