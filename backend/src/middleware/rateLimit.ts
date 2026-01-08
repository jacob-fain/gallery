import { Request, Response, NextFunction } from 'express';

// Simple in-memory rate limiter
// Tracks requests per IP within a time window

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Create a rate limiter middleware
 * @param maxRequests - Max requests allowed in the window
 * @param windowMs - Time window in milliseconds
 */
export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();

    const entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetTime) {
      // First request or window expired
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      // Rate limit exceeded - silently accept but don't process
      // (For tracking endpoints, we don't want to alert attackers)
      res.status(204).end();
      return;
    }

    entry.count++;
    next();
  };
}

// Pre-configured limiter for tracking endpoints
// 30 requests per minute per IP per endpoint
export const trackingRateLimit = rateLimit(30, 60 * 1000);
