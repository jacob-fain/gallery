import { describe, it, expect, vi, afterEach } from 'vitest';
import { createShutdown, ClosableServer } from './shutdown';

const fakeServer = () => {
  let finish: ((err?: Error) => void) | null = null;
  const server: ClosableServer & { finish: (err?: Error) => void; closed: boolean } = {
    closed: false,
    close(callback) {
      server.closed = true;
      finish = callback;
    },
    finish: (err) => finish?.(err),
  };
  return server;
};

const flush = () => new Promise((r) => setImmediate(r));

afterEach(() => {
  vi.useRealTimers();
});

describe('createShutdown', () => {
  it('closes the pool only after the server has drained, then exits 0', async () => {
    const server = fakeServer();
    const closePool = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const done = createShutdown({ server, closePool, exit, log: () => {} })('SIGTERM');

    await flush();
    expect(server.closed).toBe(true);
    expect(closePool).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    server.finish();
    await done;
    expect(closePool).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('exits 1 when draining outlasts the timeout', async () => {
    vi.useFakeTimers();
    const server = fakeServer();
    const closePool = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    void createShutdown({ server, closePool, exit, timeoutMs: 1000, log: () => {} })('SIGTERM');

    vi.advanceTimersByTime(999);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(closePool).not.toHaveBeenCalled();
  });

  it('exits 1 when closing the pool fails', async () => {
    const server = fakeServer();
    const closePool = vi.fn().mockRejectedValue(new Error('boom'));
    const exit = vi.fn();
    const done = createShutdown({ server, closePool, exit, log: () => {} })('SIGINT');
    server.finish();
    await done;
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('ignores a second signal while shutting down', async () => {
    const server = fakeServer();
    const close = vi.spyOn(server, 'close');
    const closePool = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const shutdown = createShutdown({ server, closePool, exit, log: () => {} });
    const first = shutdown('SIGTERM');
    await shutdown('SIGINT');
    server.finish();
    await first;
    expect(close).toHaveBeenCalledOnce();
    expect(closePool).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
