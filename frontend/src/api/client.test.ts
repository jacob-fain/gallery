import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
const { clearCache, getAdminStats, getGalleryPhotos, onSessionExpired, uploadPhoto } = await import('./client');

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ status, ok: status < 400, json: async () => body });

describe('admin requests and session expiry', () => {
  afterEach(() => {
    onSessionExpired(null);
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
  });

  it('signals an ended session on a 401', async () => {
    const expired = vi.fn();
    onSessionExpired(expired);
    vi.stubGlobal('fetch', respond(401, { success: false, error: 'Invalid or expired token' }));
    await expect(getAdminStats('t')).rejects.toThrow('Invalid or expired token');
    expect(expired).toHaveBeenCalledOnce();
  });

  it('does not signal on other errors', async () => {
    const expired = vi.fn();
    onSessionExpired(expired);
    vi.stubGlobal('fetch', respond(500, { success: false, error: 'boom' }));
    await expect(getAdminStats('t')).rejects.toThrow('boom');
    expect(expired).not.toHaveBeenCalled();
  });

  it('signals an ended session when an upload gets a 401 that is not JSON', async () => {
    const expired = vi.fn();
    onSessionExpired(expired);
    class FakeXhr {
      status = 401;
      responseText = '<html>Unauthorized</html>';
      upload = { addEventListener: () => {} };
      private listeners: Record<string, () => void> = {};
      addEventListener(event: string, fn: () => void) {
        this.listeners[event] = fn;
      }
      open() {}
      setRequestHeader() {}
      send() {
        this.listeners.load?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    await expect(uploadPhoto('t', null, new File(['x'], 'a.jpg'))).rejects.toThrow();
    expect(expired).toHaveBeenCalledOnce();
  });
});

describe('fresh photo fetches', () => {
  afterEach(() => {
    clearCache();
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
  });

  it('skips the in-memory cache and revalidates the HTTP cache', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ success: true, data: [{ id: 'old' }] }) })
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ success: true, data: [{ id: 'new' }] }) });
    vi.stubGlobal('fetch', fetchMock);

    expect(await getGalleryPhotos('g')).toEqual([{ id: 'old' }]);
    expect(await getGalleryPhotos('g')).toEqual([{ id: 'old' }]);
    expect(fetchMock).toHaveBeenCalledOnce();

    expect(await getGalleryPhotos('g', undefined, { fresh: true })).toEqual([{ id: 'new' }]);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/galleries/g/photos', { cache: 'no-cache' });
    // The fresh response replaces the cached one.
    expect(await getGalleryPhotos('g')).toEqual([{ id: 'new' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
