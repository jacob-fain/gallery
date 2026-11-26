import type { RequestHandler, Response } from 'express';

/**
 * How long a browser may reuse a public response without asking again.
 * Responses carry signed URLs, which the API hands out only while 30+
 * minutes remain (MIN_REMAINING_LIFETIME_MS in services/s3Service.ts), and
 * the SPA keeps a response in memory for another 5 minutes, so this must stay
 * at or under 5 minutes. It is shorter still so that hiding a photo or
 * changing the hero or a cover shows on the public site within a minute.
 */
export const PUBLIC_MAX_AGE_SECONDS = 60;

/**
 * Every API response defaults to no-store: errors, admin data, private
 * gallery content, and counted requests. Only a handler that has produced a
 * public success response opts in to caching, with cachePublicly.
 */
export const noStoreByDefault: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

/**
 * Mark a successful response as safe for any cache to keep briefly. Express
 * adds an ETag to JSON responses, so a revalidation after max-age is a 304
 * when nothing changed.
 */
export const cachePublicly = (res: Response): void => {
  res.set('Cache-Control', `public, max-age=${PUBLIC_MAX_AGE_SECONDS}`);
};
