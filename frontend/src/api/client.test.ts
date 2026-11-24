import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
const {
  clearCache,
  getAdminStats,
  getGallery,
  getGalleryPhotos,
  getPhotoDownloadUrl,
  isKnownPrivateGallery,
  onSessionExpired,
  uploadPhoto,
  verifyGalleryPassword,
} = await import('./client');

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
    fire(event: string) {
      this.listeners[event]?.();
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

  it('aborts the request when its signal fires', async () => {
    const abort = vi.fn();
    vi.stubGlobal(
      'XMLHttpRequest',
      class extends fakeXhr(0, '') {
        send() {}
        abort() {
          abort();
          this.fire('abort');
        }
      }
    );
    const controller = new AbortController();
    const upload = uploadPhoto('t', null, new File(['x'], 'a.jpg'), undefined, controller.signal);
    controller.abort();
    await expect(upload).rejects.toMatchObject({ status: 0, message: 'Upload aborted' });
    expect(abort).toHaveBeenCalledOnce();
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

describe('concurrent public fetches', () => {
  afterEach(() => {
    clearCache();
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
  });

  const deferred = () => {
    let resolve!: (data: unknown) => void;
    const response = new Promise((r) => {
      resolve = (data) => r({ status: 200, ok: true, json: async () => ({ success: true, data }) });
    });
    return { response, resolve };
  };

  it('share one request while it is in flight', async () => {
    const pending = deferred();
    const fetchMock = vi.fn().mockReturnValue(pending.response);
    vi.stubGlobal('fetch', fetchMock);

    const first = getGallery('g');
    const second = getGallery('g');
    pending.resolve({ id: 'g' });
    expect(await first).toEqual({ id: 'g' });
    expect(await second).toEqual({ id: 'g' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retry after a failed request instead of sharing or caching the failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, ok: false, statusText: 'Server Error' })
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ success: true, data: { id: 'g' } }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getGallery('g')).rejects.toMatchObject({ status: 500 });
    expect(await getGallery('g')).toEqual({ id: 'g' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('let a fresh request bypass one in flight and keep its newer data cached', async () => {
    const stale = deferred();
    const fresh = deferred();
    const fetchMock = vi.fn().mockReturnValueOnce(stale.response).mockReturnValueOnce(fresh.response);
    vi.stubGlobal('fetch', fetchMock);

    const first = getGalleryPhotos('g');
    const refresh = getGalleryPhotos('g', undefined, { fresh: true });
    fresh.resolve([{ id: 'new' }]);
    expect(await refresh).toEqual([{ id: 'new' }]);
    stale.resolve([{ id: 'old' }]);
    expect(await first).toEqual([{ id: 'old' }]);

    // The older response arrived last but does not replace the fresh one.
    expect(await getGalleryPhotos('g')).toEqual([{ id: 'new' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('known private galleries', () => {
  afterEach(() => {
    clearCache();
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
  });

  it('remembers the latest metadata response, past the cache', async () => {
    const privateGallery = { title: 'P', slug: 'p', is_public: false, requires_password: true };
    vi.stubGlobal('fetch', respond(200, { success: true, data: privateGallery }));
    expect(isKnownPrivateGallery('p')).toBe(false);
    await getGallery('p');
    expect(isKnownPrivateGallery('p')).toBe(true);

    clearCache();
    expect(isKnownPrivateGallery('p')).toBe(true);

    vi.stubGlobal('fetch', respond(200, { success: true, data: { title: 'P', slug: 'p', is_public: true } }));
    await getGallery('p');
    expect(isKnownPrivateGallery('p')).toBe(false);
  });
});

describe('photo downloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
  });

  it('asks the download endpoint for the original, with the access token for a private gallery', async () => {
    const fetchMock = respond(200, { success: true, data: { filename: 'a.jpg', downloadUrl: 'https://s3/original' } });
    vi.stubGlobal('fetch', fetchMock);
    expect(await getPhotoDownloadUrl('p1', 'tok en')).toBe('https://s3/original');
    expect(fetchMock).toHaveBeenCalledWith('/api/photos/p1/download?access=tok%20en', undefined);
    await getPhotoDownloadUrl('p1');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/photos/p1/download', undefined);
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
