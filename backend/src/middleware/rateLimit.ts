import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// Bounds memory when many distinct clients arrive inside one window. Past
// this size, expired entries are swept first, then the oldest are dropped.
const MAX_ENTRIES = 10_000;

const rateLimitStore = new Map<string, RateLimitEntry>();

const sweepExpired = (now: number): void => {
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
};

setInterval(() => sweepExpired(Date.now()), 5 * 60 * 1000).unref();

const makeRoom = (now: number): void => {
  if (rateLimitStore.size < MAX_ENTRIES) return;
  sweepExpired(now);
  // Map iterates in insertion order, so the first keys are the oldest.
  for (const key of rateLimitStore.keys()) {
    if (rateLimitStore.size < MAX_ENTRIES) break;
    rateLimitStore.delete(key);
  }
};

export interface RateLimitOptions {
  /** Identifies the limiter, so each one counts separately per client. */
  name: string;
  max: number;
  windowMs: number;
  /**
   * 'reject' answers 429 with a readable error. 'drop' answers 204 and skips
   * the handler: for fire-and-forget tracking, where the client ignores the
   * response anyway.
   */
  onLimit?: 'reject' | 'drop';
  message?: string;
}

/**
 * Per-client fixed-window limiter. The client is req.ip, which is the real
 * visitor only because trust proxy is set for the nginx hop (app.ts).
 */
export function rateLimit({
  name,
  max,
  windowMs,
  onLimit = 'reject',
  message = 'Too many requests. Please try again later.',
}: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    // Keyed by limiter, not by path: a path with an id in it would give
    // every id its own budget.
    const key = `${name}:${ip}`;
    const now = Date.now();

    const entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetTime) {
      makeRoom(now);
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }

    if (entry.count >= max) {
      if (onLimit === 'drop') {
        res.status(204).end();
        return;
      }
      res.set('Retry-After', String(Math.ceil((entry.resetTime - now) / 1000)));
      res.status(429).json({ success: false, error: message });
      return;
    }

    entry.count++;
    next();
  };
}

/** Test hook: empties the shared store between cases. */
export const resetRateLimits = (): void => rateLimitStore.clear();

export const trackingRateLimit = rateLimit({
  name: 'tracking',
  max: 120,
  windowMs: 60 * 1000,
  onLimit: 'drop',
});

export const loginRateLimit = rateLimit({
  name: 'login',
  max: 10,
  windowMs: 15 * 60 * 1000,
  message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
});

export const galleryPasswordRateLimit = rateLimit({
  name: 'gallery-password',
  max: 20,
  windowMs: 15 * 60 * 1000,
  message: 'Too many password attempts. Please wait a few minutes and try again.',
});

export const contactRateLimit = rateLimit({
  name: 'contact',
  max: 5,
  windowMs: 60 * 60 * 1000,
  message: 'Too many messages from this connection. Please try again later.',
});

// The browser reporter sends at most a few reports per page load, so this
// admits a visitor reloading a broken page many times over. Past it, reports
// are dropped silently: the beacon ignores the response.
export const clientErrorRateLimit = rateLimit({
  name: 'client-errors',
  max: 30,
  windowMs: 15 * 60 * 1000,
  onLimit: 'drop',
});
