import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express, { Router } from 'express';
import { createLogger } from '../utils/logger';
import { createRequestMetrics } from '../services/requestMetrics';
import { createRequestLog, UNMATCHED } from './requestLog';
import app from '../app';
import { requestMetrics } from '../services/requestMetrics';

const listen = async (handler: express.Express) => {
  const server = handler.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};
const close = async (server: Server) => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

describe('request log middleware', () => {
  const lines: Record<string, unknown>[] = [];
  const metrics = createRequestMetrics();
  let n = 0;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const logger = createLogger({ level: () => 'debug', write: (_l, line) => lines.push(JSON.parse(line)) });
    const test = express();
    test.use(createRequestLog({ logger, metrics, newId: () => `id-${++n}` }));
    const galleries = Router();
    galleries.get('/:slug/photos', (req, res) => {
      logger.info('inside handler');
      res.json({ slug: req.params.slug });
    });
    test.use('/api/galleries', galleries);
    test.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
    test.get('/api/boom', () => {
      throw new Error('boom');
    });
    test.use((_req, res) => res.status(404).json({}));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test.use((_err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: 'Internal server error' });
    });
    ({ server, base } = await listen(test));
  });
  afterAll(() => close(server));

  const last = () => lines.filter((l) => l.msg === 'request').at(-1)!;

  it('returns a fresh request id and logs the route pattern, never the raw URL', async () => {
    const res = await fetch(`${base}/api/galleries/smith-wedding/photos?access=eyJa.eyJb.c&page=2`);
    expect(res.status).toBe(200);
    const id = res.headers.get('x-request-id');
    expect(id).toMatch(/^id-\d+$/);
    const entry = last();
    expect(entry).toMatchObject({
      level: 'info',
      requestId: id,
      method: 'GET',
      route: '/api/galleries/:slug/photos',
      status: 200,
    });
    expect(typeof entry.durationMs).toBe('number');
    const all = JSON.stringify(lines);
    expect(all).not.toContain('smith-wedding');
    expect(all).not.toContain('access');
    // Lines logged while handling carry the same id.
    expect(lines.find((l) => l.msg === 'inside handler')?.requestId).toBe(id);
  });

  it('ignores a client-supplied request id', async () => {
    const res = await fetch(`${base}/api/galleries/a/photos`, { headers: { 'X-Request-Id': 'forged' } });
    expect(res.headers.get('x-request-id')).toMatch(/^id-\d+$/);
  });

  it('labels unmatched paths as one series and logs 5xx at error level', async () => {
    await fetch(`${base}/wp-login.php`);
    expect(last()).toMatchObject({ route: UNMATCHED, status: 404, level: 'info' });
    const res = await fetch(`${base}/api/boom`);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
    expect(last()).toMatchObject({ route: '/api/boom', status: 500, level: 'error' });
  });

  it('counts successful health checks without logging them', async () => {
    const before = lines.length;
    await fetch(`${base}/api/health`);
    expect(lines.length).toBe(before);
    expect(metrics.summarize().routes.find((r) => r.route === 'GET /api/health')?.count).toBe(1);
  });

  it('records every request in the metrics by route pattern', () => {
    const routes = metrics.summarize().routes.map((r) => r.route);
    expect(routes).toEqual(
      expect.arrayContaining(['GET /api/galleries/:slug/photos', `GET ${UNMATCHED}`, 'GET /api/boom'])
    );
  });
});

describe('request log through the app', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => ({ server, base } = await listen(app)));
  afterAll(() => close(server));

  it('every response carries a distinct X-Request-Id', async () => {
    const a = await fetch(`${base}/api/health`);
    const b = await fetch(`${base}/api/nope`);
    const ids = [a.headers.get('x-request-id'), b.headers.get('x-request-id')];
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('records real routes by their pattern', async () => {
    await fetch(`${base}/api/galleries/some-slug`);
    const routes = requestMetrics.summarize().routes.map((r) => r.route);
    expect(routes).toContain('GET /api/galleries/:slug');
    expect(routes.join(' ')).not.toContain('some-slug');
  });
});
