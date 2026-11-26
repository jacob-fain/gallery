import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteObjectsCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const send = vi.fn();
vi.mock('../config/s3', () => ({
  s3Client: { send: (...args: unknown[]) => send(...args) },
  S3_BUCKET: 'test-bucket',
  isS3Configured: () => true,
}));

const { deleteFiles, uploadFile } = await import('./s3Service');

const keys = (n: number) => Array.from({ length: n }, (_, i) => `galleries/g/${i}.jpg`);

describe('deleteFiles', () => {
  beforeEach(() => {
    send.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sends one DeleteObjects request per 1000 keys', async () => {
    send.mockResolvedValue({});
    expect(await deleteFiles(keys(2500))).toBe(0);

    expect(send).toHaveBeenCalledTimes(3);
    const sizes = send.mock.calls.map(([cmd]) => {
      expect(cmd).toBeInstanceOf(DeleteObjectsCommand);
      expect(cmd.input.Bucket).toBe('test-bucket');
      return cmd.input.Delete.Objects.length;
    });
    expect(sizes).toEqual([1000, 1000, 500]);
    expect(send.mock.calls[2][0].input.Delete.Objects[0]).toEqual({ Key: 'galleries/g/2000.jpg' });
  });

  it('sends nothing for no keys', async () => {
    expect(await deleteFiles([])).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('counts per-key errors and failed batches without throwing', async () => {
    send
      .mockResolvedValueOnce({ Errors: [{ Key: 'a' }, { Key: 'b' }] })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({});
    expect(await deleteFiles(keys(2100))).toBe(2 + 1000);
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe('uploadFile', () => {
  it('stores the object with a long browser cache lifetime', async () => {
    send.mockReset();
    send.mockResolvedValue({});
    await uploadFile(Buffer.from('x'), 'galleries/g/p/web.webp', 'image/webp');
    const [cmd] = send.mock.calls[0];
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).toMatchObject({
      Key: 'galleries/g/p/web.webp',
      ContentType: 'image/webp',
      CacheControl: 'private, max-age=31536000, immutable',
    });
  });
});
