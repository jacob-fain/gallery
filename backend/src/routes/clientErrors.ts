import express, { type Request, type Response } from 'express';
import { createRouter } from '../middleware/requestLog';
import { clientErrorRateLimit } from '../middleware/rateLimit';
import { clientErrorMetrics } from '../services/clientErrorMetrics';
import { logger, pathOnly } from '../utils/logger';

/**
 * Small on purpose: a report is a message, a truncated stack and a few short
 * strings. The app-wide JSON limit is far larger, so this router is mounted
 * ahead of that parser (app.ts).
 */
export const CLIENT_ERROR_BODY_LIMIT = '8kb';

export const LIMITS = { message: 500, stack: 4000, path: 300, release: 64, userAgent: 300 };

export const SOURCES = ['error', 'unhandledrejection', 'boundary', 'chunk'] as const;
type Source = (typeof SOURCES)[number];

export interface ClientErrorReport {
  source: Source;
  message: string;
  stack?: string;
  path: string;
  release?: string;
  userAgent?: string;
}

const RELEASE = /^[\w.:-]+$/;

const optionalString = (value: unknown, max: number): string | undefined | null => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

/**
 * The fields worth logging from a report, truncated, or null when the body
 * is not a report. The path is cut at its query string and hash again here:
 * a client that skipped its own redaction must still not put a ?access token
 * in the log.
 */
export const parseClientError = (body: unknown, headerUserAgent?: string): ClientErrorReport | null => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (!SOURCES.includes(b.source as Source)) return null;
  if (typeof b.message !== 'string' || !b.message.trim()) return null;
  if (typeof b.url !== 'string' || !b.url.startsWith('/')) return null;

  const stack = optionalString(b.stack, LIMITS.stack);
  const release = optionalString(b.release, LIMITS.release);
  const userAgent = optionalString(b.userAgent, LIMITS.userAgent);
  if (stack === null || release === null || userAgent === null) return null;

  const report: ClientErrorReport = {
    source: b.source as Source,
    message: b.message.trim().slice(0, LIMITS.message),
    path: pathOnly(b.url).slice(0, LIMITS.path),
  };
  if (stack) report.stack = stack;
  // An unrecognizable release is dropped rather than refusing the report.
  if (release && RELEASE.test(release)) report.release = release;
  const ua = userAgent ?? headerUserAgent?.slice(0, LIMITS.userAgent);
  if (ua) report.userAgent = ua;
  return report;
};

const router = createRouter();

// Public on purpose: errors on the public site matter as much as the admin's.
// The client posts with fetch (keepalive, no credentials) and a text/plain
// body, which needs no CORS preflight, so the parser accepts it as JSON too.
router.post(
  '/',
  (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  },
  clientErrorRateLimit,
  express.json({ limit: CLIENT_ERROR_BODY_LIMIT, type: ['application/json', 'text/plain'] }),
  (req: Request, res: Response) => {
    const report = parseClientError(req.body, req.get('user-agent'));
    if (!report) {
      res.status(400).json({ success: false, error: 'Invalid error report' });
      return;
    }
    clientErrorMetrics.record();
    logger.warn('client error', { ...report });
    res.status(204).end();
  }
);

export default router;
