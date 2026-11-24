import { CookieOptions, NextFunction, Request, Response } from 'express';

export const SESSION_COOKIE = 'admin_session';

// Matches the admin token's lifetime (JWT_EXPIRY in services/authService.ts).
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// No Domain attribute, so the cookie stays on the admin host that set it and
// never reaches the public site. Path=/api keeps it off page and asset
// requests. Secure everywhere but local development, which runs over plain
// http.
const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV !== 'development',
  sameSite: 'strict',
  path: '/api',
});

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_MAX_AGE_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** The session cookie's value, or null when the request carries none. */
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1 || part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value || null;
  }
  return null;
}

/**
 * The admin site's origin: FRONTEND_URL is the public site, and the admin UI
 * is the same host under the manage. subdomain.
 */
export function adminOrigin(): string | null {
  const frontend = process.env.FRONTEND_URL;
  if (!frontend) return null;
  try {
    const url = new URL(frontend);
    const host = url.host.startsWith('manage.') ? url.host : `manage.${url.host}`;
    return `${url.protocol}//${host}`;
  } catch {
    return null;
  }
}

const DEV_HOSTS = new Set(['localhost', '127.0.0.1', 'manage.localhost']);

function isAllowedOrigin(origin: string): boolean {
  if (origin === adminOrigin()) return true;
  if (process.env.NODE_ENV !== 'development') return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && DEV_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function refererOrigin(req: Request): string | null {
  const referer = req.headers.referer;
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard for cookie-authenticated requests. SameSite=Strict keeps the
 * cookie off cross-site requests, but the public site is the same site, and
 * CORS lets it make credentialed requests here. So any request that names a
 * foreign Origin is refused, reads included, and a state-changing request
 * must show the admin origin in Origin or Referer. Browsers send Origin on
 * every non-GET fetch, so one with neither header did not come from the admin
 * UI. Same-origin GETs may carry no Origin and pass on the cookie alone.
 */
export function hasAdminOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (origin) return isAllowedOrigin(origin);
  if (SAFE_METHODS.has(req.method)) return true;
  const referer = refererOrigin(req);
  return referer !== null && isAllowedOrigin(referer);
}

export function refuseOrigin(res: Response): void {
  res.status(403).json({ success: false, error: 'Request origin not allowed' });
}

export function requireAdminOrigin(req: Request, res: Response, next: NextFunction): void {
  if (hasAdminOrigin(req)) next();
  else refuseOrigin(res);
}
