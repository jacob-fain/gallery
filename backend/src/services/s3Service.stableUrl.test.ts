import { describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';

// The real signer with fixed credentials: no request is sent.
vi.mock('../config/s3', () => ({
  s3Client: new S3Client({
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' },
  }),
  S3_BUCKET: 'bucket',
  isS3Configured: () => true,
}));

const { getSignedUrl } = await import('./s3Service');
const { getSignedUrl: presign } = await import('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = await import('@aws-sdk/client-s3');
const { s3Client } = await import('../config/s3');

describe('signed photo URLs', () => {
  it('are the same URL whenever they are signed within one window, by any process', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:31:00Z'));
      const url = await getSignedUrl('galleries/g/p/web.webp');
      // Another process (or this one after a restart) signing later in the
      // window, without the cache.
      vi.setSystemTime(new Date('2026-01-01T00:59:00Z'));
      const again = await presign(s3Client, new GetObjectCommand({ Bucket: 'bucket', Key: 'galleries/g/p/web.webp' }), {
        expiresIn: 3600,
        signingDate: new Date('2026-01-01T00:30:00Z'),
      });
      expect(again).toBe(url);
      const params = new URL(url).searchParams;
      expect(params.get('X-Amz-Date')).toBe('20260101T003000Z');
      expect(params.get('X-Amz-Expires')).toBe('3600');
    } finally {
      vi.useRealTimers();
    }
  });
});
