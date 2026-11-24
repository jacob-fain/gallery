import { randomUUID } from 'crypto';
import { METHODS } from 'http';
import { Router, type NextFunction, type Request, type RequestHandler, type Response, type RouterOptions } from 'express';
import { Logger, logger as defaultLogger, requestContext } from '../utils/logger';
import { requestMetrics } from '../services/requestMetrics';

/** Label for requests no route matched, so probes for random paths stay one series. */
export const UNMATCHED = '(unmatched)';

// The methods a Route can register handlers for, as the router package derives them.
const ROUTE_METHODS = [...METHODS.map((m) => m.toLowerCase()), 'all'];

const joinPattern = (baseUrl: string, path: unknown): string => {
  const route = `${baseUrl}${typeof path === 'string' ? path : String(path)}`;
  return route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route;
};

// Runs as the first handler of every route a createRouter router defines,
// while req.baseUrl still holds the router's mount path. Express resets
// req.baseUrl when a handler calls next(err) and the error leaves the router,
// but leaves req.route set, so reading both at the end would label a failed
// POST /api/photos/upload as POST /upload.
const recordRoutePattern: RequestHandler = (req, res, next) => {
  res.locals.routePattern = joinPattern(req.baseUrl, (req.route as { path?: unknown }).path);
  next();
};

/**
 * An Express router whose routes record their full pattern for the request
 * log, so a request that fails inside a router is still labeled with the
 * route that took it. Every API router is made with this instead of Router().
 */
export const createRouter = (options?: RouterOptions): Router => {
  const router = Router(options);
  const route = router.route.bind(router);
  router.route = ((path: string) => {
    const r = route(path);
    const adders = r as unknown as Record<string, (...handlers: unknown[]) => unknown>;
    for (const method of ROUTE_METHODS) {
      const add = adders[method];
      if (typeof add !== 'function') continue;
      adders[method] = (...handlers) => add.call(r, recordRoutePattern, ...handlers);
    }
    return r;
  }) as typeof router.route;
  return router;
};

/**
 * The route pattern that handled the request ("/api/galleries/:slug"), never
 * the raw URL, which can carry ids, slugs and query strings. Read when the
 * response ends. Prefers the pattern a createRouter route recorded; a route
 * defined elsewhere falls back to req.baseUrl and req.route, which are only
 * both still accurate when the route answered without an error.
 */
export const routePattern = (req: Request, res: Response | undefined = req.res): string => {
  const recorded: unknown = res?.locals?.routePattern;
  if (typeof recorded === 'string') return recorded;
  const path = (req.route as { path?: unknown } | undefined)?.path;
  if (path === undefined) return UNMATCHED;
  return joinPattern(req.baseUrl ?? '', path);
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
    const route = routePattern(req, res);
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
