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

const { signingWindow, getSignedUrl, MIN_REMAINING_LIFETIME_MS } = await import('./s3Service');

const MINUTE = 60 * 1000;

describe('signingWindow', () => {
  it('splits time into windows that leave a one-hour URL the minimum lifetime at their end', () => {
    const window = signingWindow(Date.UTC(2026, 0, 1, 0, 45), 3600)!;
    expect(window.start).toBe(Date.UTC(2026, 0, 1, 0, 30));
    expect(window.end - window.start).toBe(30 * MINUTE);
    expect(window.start + 3600 * 1000 - window.end).toBe(MIN_REMAINING_LIFETIME_MS);
  });

  it('never shares a URL whose whole lifetime is under the minimum', () => {
    expect(signingWindow(5000, 600)).toBeNull();
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

  it('signs as of the window start, serves that URL for the window, and signs anew after it', async () => {
    const presigner = await import('@aws-sdk/s3-request-presigner');
    vi.mocked(presigner.getSignedUrl).mockClear();
    vi.setSystemTime(new Date('2026-01-01T00:10:00Z'));
    const first = await getSignedUrl('a.jpg');
    expect(vi.mocked(presigner.getSignedUrl).mock.calls[0][2]).toEqual({
      expiresIn: 3600,
      signingDate: new Date('2026-01-01T00:00:00Z'),
    });

    vi.setSystemTime(new Date('2026-01-01T00:29:59.999Z'));
    expect(await getSignedUrl('a.jpg')).toBe(first);

    vi.setSystemTime(new Date('2026-01-01T00:30:00Z'));
    const second = await getSignedUrl('a.jpg');
    expect(second).not.toBe(first);
    expect(vi.mocked(presigner.getSignedUrl).mock.calls[1][2]).toMatchObject({
      signingDate: new Date('2026-01-01T00:30:00Z'),
    });
  });

  it('never caches a short-lived URL, and signs it as of now', async () => {
    const presigner = await import('@aws-sdk/s3-request-presigner');
    vi.mocked(presigner.getSignedUrl).mockClear();
    const first = await getSignedUrl('b.jpg', 300);
    expect(await getSignedUrl('b.jpg', 300)).not.toBe(first);
    expect(vi.mocked(presigner.getSignedUrl).mock.calls[0][2]).toEqual({ expiresIn: 300 });
  });

  it('keeps URLs for a download name apart from the plain URL', async () => {
    const plain = await getSignedUrl('f.jpg');
    const named = await getSignedUrl('f.jpg', undefined, 'photo.jpg');
    expect(named).not.toBe(plain);
    expect(await getSignedUrl('f.jpg')).toBe(plain);
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
