import type { Request } from 'express';

/**
 * The request header that carries a private gallery's access token. Never a
 * query parameter: nginx's error log records the full request line when the
 * API fails, and its format cannot leave the query string out.
 */
export const GALLERY_ACCESS_HEADER = 'X-Gallery-Access';

export const galleryAccessToken = (req: Request): string | undefined =>
  req.get(GALLERY_ACCESS_HEADER) || undefined;
