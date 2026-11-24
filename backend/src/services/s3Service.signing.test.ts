import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/s3', () => ({
  s3Client: {},
  S3_BUCKET: 'bucket',
  isS3Configured: () => true,
}));

let signed = 0;
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => `https://s3.example/signed-${++signed}`),
}));

const { cacheReuseDeadline, getSignedUrl, MIN_REMAINING_LIFETIME_MS } = await import('./s3Service');

const MINUTE = 60 * 1000;

describe('cacheReuseDeadline', () => {
  it('reuses a one-hour URL only while it has at least the minimum lifetime left', () => {
    const deadline = cacheReuseDeadline(0, 3600);
    expect(deadline).toBe(10 * MINUTE);
    expect(3600 * 1000 - deadline).toBe(MIN_REMAINING_LIFETIME_MS);
  });

  it('never reuses a URL whose whole lifetime is under the minimum', () => {
    expect(cacheReuseDeadline(5000, 600)).toBe(5000);
  });
});

describe('getSignedUrl cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves a cached URL inside the reuse window and signs a new one after it', async () => {
    const first = await getSignedUrl('a.jpg');

    vi.advanceTimersByTime(10 * MINUTE - 1);
    expect(await getSignedUrl('a.jpg')).toBe(first);

    vi.advanceTimersByTime(1);
    const second = await getSignedUrl('a.jpg');
    expect(second).not.toBe(first);
  });

  it('never caches a short-lived URL', async () => {
    const first = await getSignedUrl('b.jpg', 300);
    expect(await getSignedUrl('b.jpg', 300)).not.toBe(first);
  });
});

describe('getSignedUrl in-flight signing', () => {
  it('signs once for concurrent cold requests of the same object', async () => {
    const presigner = await import('@aws-sdk/s3-request-presigner');
    vi.mocked(presigner.getSignedUrl).mockClear();
    const urls = await Promise.all([getSignedUrl('c.jpg'), getSignedUrl('c.jpg'), getSignedUrl('c.jpg')]);
    expect(new Set(urls).size).toBe(1);
    expect(presigner.getSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('never hands a short-lived signature to a caller asking for a long one', async () => {
    const presigner = await import('@aws-sdk/s3-request-presigner');
    vi.mocked(presigner.getSignedUrl).mockClear();
    const [short, long] = await Promise.all([getSignedUrl('d.jpg', 300), getSignedUrl('d.jpg')]);
    expect(short).not.toBe(long);
    expect(presigner.getSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('signs again after a failed signing instead of repeating the failure', async () => {
    const presigner = await import('@aws-sdk/s3-request-presigner');
    vi.mocked(presigner.getSignedUrl).mockRejectedValueOnce(new Error('clock skew'));
    await expect(getSignedUrl('e.jpg')).rejects.toThrow('clock skew');
    await expect(getSignedUrl('e.jpg')).resolves.toMatch(/^https:\/\/s3\.example\/signed-/);
  });
});
