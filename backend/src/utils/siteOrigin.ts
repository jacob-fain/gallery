import type { Request } from 'express';

/**
 * The public origin that absolute links to the site are written under.
 * FRONTEND_URL is the public site in production; the request is only a
 * fallback, since behind the tunnel nginx sees plain http.
 */
export const siteOrigin = (req: Request): string =>
  (process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
