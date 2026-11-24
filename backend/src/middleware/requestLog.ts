import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { Logger, logger as defaultLogger, requestContext } from '../utils/logger';
import { requestMetrics } from '../services/requestMetrics';

/** Label for requests no route matched, so probes for random paths stay one series. */
export const UNMATCHED = '(unmatched)';

/**
 * The route pattern that handled the request ("/api/galleries/:slug"), never
 * the raw URL, which can carry ids, slugs and ?access tokens. Read when the
 * response ends: Express leaves req.baseUrl and req.route set for the router
 * that answered.
 */
export const routePattern = (req: Request): string => {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  if (path === undefined) return UNMATCHED;
  const route = `${req.baseUrl}${typeof path === 'string' ? path : String(path)}`;
  return route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route;
};

// Liveness and readiness are polled every few seconds; a success there is
// counted in the metrics but not logged.
const QUIET_ROUTES = new Set(['/api/health', '/api/health/ready']);

/**
 * Gives each request an id (returned as X-Request-Id and attached to every
 * line logged while handling it), then logs one line when the response
 * finishes or the client goes away, and records its timing.
 */
export const createRequestLog = ({
  logger = defaultLogger,
  metrics = requestMetrics,
  newId = randomUUID,
}: {
  logger?: Logger;
  metrics?: { record: (s: { method: string; route: string; status: number; durationMs: number }) => void };
  newId?: () => string;
} = {}) => (req: Request, res: Response, next: NextFunction) => {
  // Always generated here: an id taken from the client could be forged to
  // tie unrelated lines together or to inject text into the log.
  const requestId = newId();
  const started = process.hrtime.bigint();
  res.setHeader('X-Request-Id', requestId);

  let done = false;
  const finish = (aborted: boolean) => {
    if (done) return;
    done = true;
    const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100;
    const route = routePattern(req);
    const status = res.statusCode;
    metrics.record({ method: req.method, route, status, durationMs });
    if (!aborted && status < 400 && QUIET_ROUTES.has(route)) return;
    const fields = {
      requestId,
      method: req.method,
      route,
      status,
      durationMs,
      ...(aborted ? { aborted: true } : {}),
    };
    if (status >= 500) logger.error('request', fields);
    else logger.info('request', fields);
  };
  res.on('finish', () => finish(false));
  res.on('close', () => finish(!res.writableFinished));

  requestContext.run({ requestId }, () => next());
};

export const requestLog = createRequestLog();
