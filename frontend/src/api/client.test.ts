import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'example.com' } });
const { getAdminStats, onSessionExpired, uploadPhoto } = await import('./client');

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
