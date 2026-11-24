import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit, resetRateLimits } from './rateLimit';

const fakeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    set(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
  return res;
};

const hit = (limiter: ReturnType<typeof rateLimit>, ip: string, path = '/') => {
  const req = { ip, path, socket: {} } as unknown as Request;
  const res = fakeRes();
  const next = vi.fn() as unknown as NextFunction;
  limiter(req, res as unknown as Response, next);
  return { res, passed: (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length === 1 };
};

describe('rateLimit', () => {
  beforeEach(() => {
    resetRateLimits();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('admits up to the limit, then answers 429 with a message and Retry-After', () => {
    const limiter = rateLimit({ name: 't-reject', max: 2, windowMs: 60_000, message: 'Slow down' });
    expect(hit(limiter, '1.1.1.1').passed).toBe(true);
    expect(hit(limiter, '1.1.1.1').passed).toBe(true);
    const third = hit(limiter, '1.1.1.1');
    expect(third.passed).toBe(false);
    expect(third.res.statusCode).toBe(429);
    expect(third.res.body).toEqual({ success: false, error: 'Slow down' });
    expect(Number(third.res.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('counts each client separately', () => {
    const limiter = rateLimit({ name: 't-clients', max: 1, windowMs: 60_000 });
    expect(hit(limiter, '1.1.1.1').passed).toBe(true);
    expect(hit(limiter, '2.2.2.2').passed).toBe(true);
    expect(hit(limiter, '1.1.1.1').passed).toBe(false);
  });

  it('shares one budget across paths, so changing the id in the URL does not reset it', () => {
    const limiter = rateLimit({ name: 't-paths', max: 2, windowMs: 60_000 });
    expect(hit(limiter, '1.1.1.1', '/photo-a/view').passed).toBe(true);
    expect(hit(limiter, '1.1.1.1', '/photo-b/view').passed).toBe(true);
    expect(hit(limiter, '1.1.1.1', '/photo-c/view').passed).toBe(false);
  });

  it('keeps separate budgets for separate limiters', () => {
    const a = rateLimit({ name: 't-a', max: 1, windowMs: 60_000 });
    const b = rateLimit({ name: 't-b', max: 1, windowMs: 60_000 });
    expect(hit(a, '1.1.1.1').passed).toBe(true);
    expect(hit(b, '1.1.1.1').passed).toBe(true);
  });

  it('drops silently with 204 when configured for tracking', () => {
    const limiter = rateLimit({ name: 't-drop', max: 1, windowMs: 60_000, onLimit: 'drop' });
    hit(limiter, '1.1.1.1');
    const dropped = hit(limiter, '1.1.1.1');
    expect(dropped.passed).toBe(false);
    expect(dropped.res.statusCode).toBe(204);
    expect(dropped.res.ended).toBe(true);
  });

  it('opens a new window once the old one expires', () => {
    const limiter = rateLimit({ name: 't-window', max: 1, windowMs: 60_000 });
    hit(limiter, '1.1.1.1');
    expect(hit(limiter, '1.1.1.1').passed).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(hit(limiter, '1.1.1.1').passed).toBe(true);
  });
});
