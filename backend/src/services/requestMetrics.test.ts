import { describe, expect, it } from 'vitest';
import { createRequestMetrics, percentile } from './requestMetrics';

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });
});

describe('createRequestMetrics', () => {
  const at = (start: number) => {
    let t = start;
    return { now: () => t, set: (v: number) => (t = v) };
  };

  it('groups by method and route with counts, error counts and latency', () => {
    const clock = at(1_000_000);
    const m = createRequestMetrics({ now: clock.now });
    for (let i = 1; i <= 20; i++) {
      m.record({ method: 'GET', route: '/api/galleries/:slug', status: 200, durationMs: i });
    }
    m.record({ method: 'GET', route: '/api/galleries/:slug', status: 404, durationMs: 1 });
    m.record({ method: 'POST', route: '/api/photos/upload', status: 500, durationMs: 300 });
    const s = m.summarize();
    expect(s.total).toBe(22);
    expect(s.serverErrors).toBe(1);
    expect(s.windowSeconds).toBe(3600);
    expect(s.since).toBe(new Date(1_000_000).toISOString());
    expect(s.routes).toEqual([
      { route: 'GET /api/galleries/:slug', count: 21, clientErrors: 1, serverErrors: 0, p50Ms: 10, p95Ms: 19, maxMs: 20 },
      { route: 'POST /api/photos/upload', count: 1, clientErrors: 0, serverErrors: 1, p50Ms: 300, p95Ms: 300, maxMs: 300 },
    ]);
  });

  it('leaves out samples older than the window', () => {
    const clock = at(0);
    const m = createRequestMetrics({ now: clock.now, windowMs: 1000 });
    m.record({ method: 'GET', route: '/old', status: 200, durationMs: 1 });
    clock.set(1500);
    m.record({ method: 'GET', route: '/new', status: 200, durationMs: 2 });
    const s = m.summarize();
    expect(s.routes.map((r) => r.route)).toEqual(['GET /new']);
    expect(s.since).toBe(new Date(1500).toISOString());
  });

  it('keeps only the newest samples once the buffer is full', () => {
    const m = createRequestMetrics({ capacity: 3, now: () => 1 });
    for (const route of ['/a', '/b', '/c', '/d']) {
      m.record({ method: 'GET', route, status: 200, durationMs: 1 });
    }
    expect(m.summarize().routes.map((r) => r.route).sort()).toEqual(['GET /b', 'GET /c', 'GET /d']);
  });

  it('is empty before any request', () => {
    expect(createRequestMetrics().summarize()).toEqual({
      windowSeconds: 3600,
      since: null,
      total: 0,
      serverErrors: 0,
      routes: [],
    });
  });
});
