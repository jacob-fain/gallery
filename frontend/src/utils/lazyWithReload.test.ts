import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdReloadWhile, isChunkLoadError, loadWithReload } from './lazyWithReload';

const { reportClientError } = vi.hoisted(() => ({ reportClientError: vi.fn() }));
vi.mock('./clientErrors', () => ({ reportClientError }));

const START = 1_800_000_000_000;

// A page that started at `pageStart`, in a tab whose session storage is
// `storage` (shared by the pages a tab opens, as in a browser).
function openPage(storage: Partial<Storage>, pageStart: number) {
  const reload = vi.fn();
  vi.stubGlobal('window', { location: { reload }, sessionStorage: storage });
  vi.stubGlobal('performance', { timeOrigin: pageStart });
  vi.setSystemTime(pageStart);
  return reload;
}

function memoryStorage(): Partial<Storage> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/Gallery-abc123.js');
const failing = () => Promise.reject(chunkError());

describe('loadWithReload', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    reportClientError.mockReset();
  });

  it('returns the module when the import succeeds', async () => {
    const reload = openPage(memoryStorage(), START);
    await expect(loadWithReload(() => Promise.resolve({ default: 'page' }))).resolves.toEqual({
      default: 'page',
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once on a chunk that fails to load, and a second chunk failing waits for it', async () => {
    const reload = openPage(memoryStorage(), START);
    vi.setSystemTime(START + 60_000);
    let settled = false;
    void loadWithReload(failing).finally(() => (settled = true));
    void loadWithReload(failing).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    // The reload may still fix it, so nothing is reported yet.
    expect(reportClientError).not.toHaveBeenCalled();
  });

  it('shows the error when the chunk still fails in the page the reload opened, however slowly it loaded', async () => {
    const storage = memoryStorage();
    openPage(storage, START);
    vi.setSystemTime(START + 60_000);
    void loadWithReload(failing);
    await vi.advanceTimersByTimeAsync(0);

    // The reloaded page starts at once and takes 40 s to reach the chunk.
    const reload = openPage(storage, START + 60_050);
    vi.setSystemTime(START + 100_000);
    await expect(loadWithReload(failing)).rejects.toThrow('dynamically imported module');
    expect(reload).not.toHaveBeenCalled();
    expect(reportClientError).toHaveBeenCalledOnce();
    expect(reportClientError).toHaveBeenCalledWith('chunk', expect.any(Error));
  });

  it('reloads again for a later deploy, in the reloaded page once it has been open a while', async () => {
    const storage = memoryStorage();
    openPage(storage, START);
    void loadWithReload(failing);
    await vi.advanceTimersByTimeAsync(0);

    const reload = openPage(storage, START + 50);
    vi.setSystemTime(START + 50 + 10 * 60_000);
    void loadWithReload(failing);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads again in a page opened later in the same tab', async () => {
    const storage = memoryStorage();
    openPage(storage, START);
    void loadWithReload(failing);
    await vi.advanceTimersByTimeAsync(0);

    const reload = openPage(storage, START + 60 * 60_000);
    void loadWithReload(failing);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('rethrows instead of reloading while a hold says a reload would lose work, and reloads once it lifts', async () => {
    const storage = memoryStorage();
    const reload = openPage(storage, START);
    let uploading = true;
    const release = holdReloadWhile(() => uploading);
    try {
      await expect(loadWithReload(failing)).rejects.toThrow('dynamically imported module');
      expect(reload).not.toHaveBeenCalled();
      expect(reportClientError).toHaveBeenCalledWith('chunk', expect.any(Error));
      // Not counted as a reload, so one is still allowed afterwards.
      expect(storage.getItem!('chunk-reload-at')).toBeNull();

      uploading = false;
      void loadWithReload(failing);
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
  });

  it('forgets a hold once it is removed', async () => {
    const reload = openPage(memoryStorage(), START);
    holdReloadWhile(() => true)();
    void loadWithReload(failing);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('rethrows any other error without reloading', async () => {
    const reload = openPage(memoryStorage(), START);
    await expect(loadWithReload(() => Promise.reject(new ReferenceError('x is not defined')))).rejects.toThrow(
      'x is not defined'
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it('rethrows without reloading when sessionStorage is unavailable', async () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    const reload = openPage({ getItem: blocked, setItem: blocked }, START);
    await expect(loadWithReload(failing)).rejects.toThrow('dynamically imported module');
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://example.test/assets/a.js',
    'error loading dynamically imported module: https://example.test/assets/a.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/a.css',
    'Loading chunk 12 failed.',
  ])('matches %j', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('matches a ChunkLoadError by name', () => {
    const error = new Error('anything');
    error.name = 'ChunkLoadError';
    expect(isChunkLoadError(error)).toBe(true);
  });

  it('does not match other errors', () => {
    expect(isChunkLoadError(new TypeError('x is undefined'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
  });
});
