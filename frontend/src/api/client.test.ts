import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
const {
  clearCache,
  createGallery,
  getAdminStats,
  getAllPhotos,
  getGallery,
  getGalleryPhotos,
  getCurrentUser,
  getGalleryDownloadUrl,
  getGalleryPhotosPage,
  getPhotoDownloadUrl,
  isKnownPrivateGallery,
  trackGalleryView,
  login,
  logout,
  onSessionExpired,
  updateGallery,
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
    withCredentials = false;
    headers: Record<string, string> = {};
    open() {}
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
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

  it('sends the session cookie on admin requests and no Authorization header', async () => {
    const fetchMock = respond(200, { success: true, data: {} });
    vi.stubGlobal('fetch', fetchMock);
    await getAdminStats();
    await getCurrentUser();
    await login('a@example.com', 'pw');
    await logout();
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.credentials).toBe('include');
      expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i);
    }
  });

  it('sends the session cookie with an upload', async () => {
    const sent: Array<{ withCredentials: boolean; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      'XMLHttpRequest',
      class extends fakeXhr(200, JSON.stringify({ success: true, data: { id: 'p' } })) {
        send() {
          sent.push(this);
          super.send();
        }
      }
    );
    await uploadPhoto(null, new File(['x'], 'a.jpg'));
    expect(sent[0].withCredentials).toBe(true);
    expect(sent[0].headers).toEqual({});
  });

  it('signals an ended session on a 401', async () => {
    const expired = vi.fn();
    onSessionExpired(expired);
    vi.stubGlobal('fetch', respond(401, { success: false, error: 'Invalid or expired token' }));
    await expect(getAdminStats()).rejects.toThrow('Invalid or expired token');
    expect(expired).toHaveBeenCalledOnce();
  });

  it('does not signal on other errors', async () => {
    const expired = vi.fn();
    onSessionExpired(expired);
    vi.stubGlobal('fetch', respond(500, { success: false, error: 'boom' }));
    await expect(getAdminStats()).rejects.toThrow('boom');
    expect(expired).not.toHaveBeenCalled();
  });

  it('signals an ended session when an upload gets a 401 that is not JSON', async () => {
    const expired = vi.fn();
    onSessionExpired(expired);
    vi.stubGlobal('XMLHttpRequest', fakeXhr(401, '<html>Unauthorized</html>'));
    await expect(uploadPhoto(null, new File(['x'], 'a.jpg'))).rejects.toThrow();
    expect(expired).toHaveBeenCalledOnce();
  });

  it('rejects an upload with the HTTP status so a duplicate can be told apart', async () => {
    const body = JSON.stringify({ success: false, error: 'Already uploaded as a.jpg' });
    vi.stubGlobal('XMLHttpRequest', fakeXhr(409, body));
    await expect(uploadPhoto(null, new File(['x'], 'a.jpg'))).rejects.toMatchObject({
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
    const upload = uploadPhoto(null, new File(['x'], 'a.jpg'), undefined, controller.signal);
    controller.abort();
    await expect(upload).rejects.toMatchObject({ status: 0, message: 'Upload aborted' });
    expect(abort).toHaveBeenCalledOnce();
  });

  it('names an oversized upload rejected by the proxy instead of a parse error', async () => {
    vi.stubGlobal('XMLHttpRequest', fakeXhr(413, '<html>413 Request Entity Too Large</html>'));
    await expect(uploadPhoto(null, new File(['x'], 'a.jpg'))).rejects.toMatchObject({
      status: 413,
      message: 'File is larger than the server accepts',
    });
  });
});


describe('gallery saves', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
  });

  it("rejects a taken slug with the API's message, for the form to show", async () => {
    const body = { success: false, error: 'A gallery with this slug already exists' };
    vi.stubGlobal('fetch', respond(409, body));

    await expect(createGallery({ title: 'A', slug: 'taken', is_public: true })).rejects.toThrow(
      'A gallery with this slug already exists'
    );
    await expect(updateGallery('g1', { slug: 'taken' })).rejects.toThrow(
      'A gallery with this slug already exists'
    );
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

describe('gallery slugs in API paths', () => {
  afterEach(() => {
    clearCache();
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
  });

  // The page gets a slug React Router has decoded, so /g/people%3Faccess%3D1
  // hands these "people?access=1". Each must stay one path segment.
  it.each([
    ['people?access=1', 'people%3Faccess%3D1'],
    ['?x', '%3Fx'],
    ['../galleries/people', '..%2Fgalleries%2Fpeople'],
    ['a/b', 'a%2Fb'],
  ])('encodes %s in every gallery request', async (slug, encoded) => {
    const fetchMock = respond(200, {
      success: true,
      data: { title: 'T', slug, accessToken: 't', verified: true, ticket: 'tk' },
    });
    vi.stubGlobal('fetch', fetchMock);

    await getGallery(slug);
    await getGalleryPhotos(slug);
    await getGalleryPhotos(slug, 'tok');
    await verifyGalleryPassword(slug, 'pw');
    expect(await getGalleryDownloadUrl(slug)).toBe(`/api/galleries/${encoded}/download`);
    expect(await getGalleryDownloadUrl(slug, 'tok')).toBe(`/api/galleries/${encoded}/download?ticket=tk`);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/galleries/${encoded}`,
      `/api/galleries/${encoded}/photos`,
      `/api/galleries/${encoded}/photos`,
      `/api/galleries/${encoded}/verify`,
      `/api/galleries/${encoded}/download-ticket`,
    ]);
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
    expect(fetchMock).toHaveBeenCalledWith('/api/photos/p1/download', { headers: { 'X-Gallery-Access': 'tok en' } });
    await getPhotoDownloadUrl('p1');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/photos/p1/download', undefined);
  });
});

describe('gallery ZIP downloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
  });

  it('links a public gallery straight to its ZIP', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getGalleryDownloadUrl('iceland')).toBe('/api/galleries/iceland/download');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('buys a private gallery a one-time ticket with the token in a header', async () => {
    const fetchMock = respond(200, { success: true, data: { ticket: 'tick/et' } });
    vi.stubGlobal('fetch', fetchMock);
    expect(await getGalleryDownloadUrl('smith', 'tok en')).toBe('/api/galleries/smith/download?ticket=tick%2Fet');
    expect(fetchMock).toHaveBeenCalledWith('/api/galleries/smith/download-ticket', {
      method: 'POST',
      headers: { 'X-Gallery-Access': 'tok en' },
    });
  });

  it('links without a ticket when the API says none is needed', async () => {
    vi.stubGlobal('fetch', respond(200, { success: true, data: { ticket: null } }));
    expect(await getGalleryDownloadUrl('smith', 'tok')).toBe('/api/galleries/smith/download');
  });

  it('reports a refused ticket with the API message', async () => {
    vi.stubGlobal('fetch', respond(403, { success: false, error: 'Invalid or expired access token.' }));
    await expect(getGalleryDownloadUrl('smith', 'old')).rejects.toMatchObject({
      status: 403,
      serverMessage: 'Invalid or expired access token.',
    });
  });
});

// nginx's error log records full request lines, so a token must never be
// part of a URL the client requests.
describe('gallery access tokens stay out of URLs', () => {
  afterEach(() => {
    clearCache();
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
  });

  it('sends the token only in the X-Gallery-Access header', async () => {
    const TOKEN = 'eyJSECRET.ACCESS.TOKEN';
    const fetchMock = vi.fn(async (url: string) => ({
      status: 200,
      ok: true,
      json: async () => ({
        success: true,
        data: url.endsWith('/download-ticket') ? { ticket: 'one-time' } : { downloadUrl: 'https://s3/o' },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await getGalleryPhotos('smith', TOKEN);
    await getGalleryPhotos('smith', TOKEN, { fresh: true });
    await getPhotoDownloadUrl('p1', TOKEN);
    trackGalleryView('smith', TOKEN);
    const zipUrl = await getGalleryDownloadUrl('smith', TOKEN);

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][];
    expect(calls).toHaveLength(5);
    for (const [url, init] of calls) {
      expect(url).not.toContain(TOKEN);
      expect(url).not.toMatch(/[?&]access=/);
      expect(init?.headers).toMatchObject({ 'X-Gallery-Access': TOKEN });
    }
    expect(zipUrl).toBe('/api/galleries/smith/download?ticket=one-time');
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

describe('paged photo lists', () => {
  afterEach(() => {
    clearCache();
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
  });

  const page = (data: unknown[], extra: Record<string, unknown>) => ({
    status: 200,
    ok: true,
    json: async () => ({ success: true, data, ...extra }),
  });

  it('fetches every public page, following nextCursor', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([{ id: 'a' }, { id: 'b' }], { nextCursor: 'c/1' }))
      .mockResolvedValueOnce(page([{ id: 'c' }], { nextCursor: null }));
    vi.stubGlobal('fetch', fetchMock);

    expect((await getAllPhotos()).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/photos', '/api/photos?cursor=c%2F1']);
  });

  it('lists a photo once when it comes back on two pages, and skips none', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([{ id: 'a' }, { id: 'b' }], { nextCursor: 'c/1' }))
      .mockResolvedValueOnce(page([{ id: 'b' }, { id: 'c' }], { nextCursor: 'c/2' }))
      .mockResolvedValueOnce(page([{ id: 'd' }], { nextCursor: null }));
    vi.stubGlobal('fetch', fetchMock);

    expect((await getAllPhotos(undefined, { fresh: true })).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('asks an admin list for one page with the session cookie and reports the whole length', async () => {
    const fetchMock = vi.fn().mockResolvedValue(page([{ id: 'x' }], { total: 240, nextOffset: 101 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await getGalleryPhotosPage('g1', 100, 100)).toEqual({ photos: [{ id: 'x' }], total: 240 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/galleries/g1/photos/admin?limit=100&offset=100');
    expect(init.credentials).toBe('include');
    expect(JSON.stringify(init.headers ?? {})).not.toContain('Authorization');
  });
});
