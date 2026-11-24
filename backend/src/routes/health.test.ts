import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import app from '../app';
import { createReadiness } from './health';

describe('createReadiness', () => {
  it('is ready when the probe succeeds', async () => {
    const ready = createReadiness({ probe: async () => 1 });
    expect(await ready()).toEqual({ ok: true });
  });

  it('reports a generic reason when the probe fails, never the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ready = createReadiness({
      probe: async () => {
        throw new Error('password authentication failed for user "gallery"');
      },
    });
    expect(await ready()).toEqual({ ok: false, reason: 'database unreachable' });
  });

  it('gives up after the timeout', async () => {
    const ready = createReadiness({ probe: () => new Promise(() => {}), timeoutMs: 20 });
    expect(await ready()).toEqual({ ok: false, reason: 'database timed out' });
  });

  it('shares one probe between concurrent callers and caches the answer', async () => {
    const probe = vi.fn(async () => 1);
    const ready = createReadiness({ probe, cacheMs: 60_000 });
    await Promise.all([ready(), ready(), ready()]);
    await ready();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('never starts a second probe while a hung one is unsettled', async () => {
    // A timed-out query still holds its connection; polling must not stack more.
    let release: (v: unknown) => void = () => {};
    let hung = true;
    const probe = vi.fn(() =>
      hung ? new Promise((resolve) => (release = resolve)) : Promise.resolve(1)
    );
    const ready = createReadiness({ probe, timeoutMs: 10, cacheMs: 0 });
    for (let i = 0; i < 5; i++) {
      expect(await ready()).toEqual({ ok: false, reason: 'database timed out' });
    }
    expect(probe).toHaveBeenCalledTimes(1);
    hung = false;
    release(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(await ready()).toEqual({ ok: true });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('probes again once the cache expires', async () => {
    const probe = vi.fn(async () => 1);
    const ready = createReadiness({ probe, cacheMs: 0 });
    await ready();
    await ready();
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe('health routes through the app', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /health answers 200 with the build id', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', build: 'dev' });
  });

  it('GET /health/ready reflects whether the database answers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await fetch(`${base}/health/ready`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    if (process.env.TEST_DATABASE_URL) {
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok', build: 'dev', s3: 'not configured' });
    } else {
      // Unit runs point DATABASE_URL at a closed port.
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        status: 'unavailable',
        reason: 'database unreachable',
        build: 'dev',
        s3: 'not configured',
      });
    }
  });

  it('GET /health/ready keeps "build" a single flat key the deploy can match', async () => {
    // homelab-gallery-apply reads the id with sed: .*"build":"\([0-9a-z]*\)"
    const text = await (await fetch(`${base}/health/ready`)).text();
    expect(text.match(/"build":/g)).toHaveLength(1);
    expect(text).toMatch(/"build":"dev"/);
  });
});

