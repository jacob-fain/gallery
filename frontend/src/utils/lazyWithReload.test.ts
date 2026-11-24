import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWithReload } from './lazyWithReload';

const { reportClientError } = vi.hoisted(() => ({ reportClientError: vi.fn() }));
vi.mock('./clientErrors', () => ({ reportClientError }));

function stubWindow(storage: Partial<Storage>) {
  const reload = vi.fn();
  vi.stubGlobal('window', { location: { reload }, sessionStorage: storage });
  return reload;
}

function memoryStorage(): Partial<Storage> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

const failing = () => Promise.reject(new Error('Failed to fetch dynamically imported module'));

describe('loadWithReload', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    reportClientError.mockReset();
  });

  it('returns the module when the import succeeds', async () => {
    const reload = stubWindow(memoryStorage());
    await expect(loadWithReload(() => Promise.resolve({ default: 'page' }))).resolves.toEqual({
      default: 'page',
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once on a failed import, then rethrows if it fails again right after', async () => {
    const reload = stubWindow(memoryStorage());
    void loadWithReload(failing);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1);
    // The reload may still fix it, so nothing is reported yet.
    expect(reportClientError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(loadWithReload(failing)).rejects.toThrow('dynamically imported module');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reportClientError).toHaveBeenCalledOnce();
    expect(reportClientError).toHaveBeenCalledWith('chunk', expect.any(Error));
  });

  it('reloads again for a failure well after the last reload', async () => {
    const reload = stubWindow(memoryStorage());
    void loadWithReload(failing);
    await vi.advanceTimersByTimeAsync(60_000);
    void loadWithReload(failing);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('rethrows without reloading when sessionStorage is unavailable', async () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    const reload = stubWindow({ getItem: blocked, setItem: blocked });
    await expect(loadWithReload(failing)).rejects.toThrow('dynamically imported module');
    expect(reload).not.toHaveBeenCalled();
  });
});
