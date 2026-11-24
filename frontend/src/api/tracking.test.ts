import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
const { trackGalleryView } = await import('./client');

describe('gallery view tracking', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
  });

  it('posts to the tracking endpoint, with the access token for a private gallery', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    trackGalleryView('iceland');
    trackGalleryView('wedding', 'tok en');
    expect(fetchMock.mock.calls).toEqual([
      ['/api/galleries/iceland/view', { method: 'POST' }],
      ['/api/galleries/wedding/view?access=tok%20en', { method: 'POST' }],
    ]);
  });

  it('never throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(() => trackGalleryView('iceland')).not.toThrow();
    await Promise.resolve();
  });
});
