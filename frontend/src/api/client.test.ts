import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
const { clearCache, getAdminStats, getGallery, getGalleryPhotos, onSessionExpired, uploadPhoto, verifyGalleryPassword } =
  await import('./client');

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ status, ok: status < 400, json: async () => body });

const fakeXhr = (status: number, responseText: string) =>
  class FakeXhr {
    status = status;
    responseText = responseText;
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
  };

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
    vi.stubGlobal('XMLHttpRequest', fakeXhr(401, '<html>Unauthorized</html>'));
    await expect(uploadPhoto('t', null, new File(['x'], 'a.jpg'))).rejects.toThrow();
    expect(expired).toHaveBeenCalledOnce();
  });

  it('rejects an upload with the HTTP status so a duplicate can be told apart', async () => {
    const body = JSON.stringify({ success: false, error: 'Already uploaded as a.jpg' });
    vi.stubGlobal('XMLHttpRequest', fakeXhr(409, body));
    await expect(uploadPhoto('t', null, new File(['x'], 'a.jpg'))).rejects.toMatchObject({
      status: 409,
      message: 'Already uploaded as a.jpg',
    });
  });

  it('names an oversized upload rejected by the proxy instead of a parse error', async () => {
    vi.stubGlobal('XMLHttpRequest', fakeXhr(413, '<html>413 Request Entity Too Large</html>'));
    await expect(uploadPhoto('t', null, new File(['x'], 'a.jpg'))).rejects.toMatchObject({
      status: 413,
      message: 'File is larger than the server accepts',
    });
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

describe('public request errors', () => {
  afterEach(() => {
    clearCache();
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
  });

  it('reports a missing gallery with its status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false, statusText: 'Not Found' }));
    await expect(getGallery('nope')).rejects.toMatchObject({ status: 404, serverMessage: null });
  });

  it("keeps the API's message for a wrong password", async () => {
    vi.stubGlobal('fetch', respond(401, { success: false, error: 'Invalid password' }));
    await expect(verifyGalleryPassword('g', 'x')).rejects.toMatchObject({
      status: 401,
      serverMessage: 'Invalid password',
    });
  });

  it('rejects a password check answered without JSON instead of a parse error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 502,
      ok: false,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifyGalleryPassword('g', 'x')).rejects.toMatchObject({ status: 502, serverMessage: null });
  });
});
