import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';

const { getUserById } = vi.hoisted(() => ({ getUserById: vi.fn() }));
vi.mock('../services/authService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/authService')>()),
  getUserById: (id: string) => getUserById(id),
}));

import app from '../app';
import { generateToken } from '../services/authService';
import { requestMetrics } from '../services/requestMetrics';
import { createLogger } from '../utils/logger';
import { createRequestMetrics } from '../services/requestMetrics';
import { createRequestLog, createRouter, routePattern } from './requestLog';

const listen = async (handler: express.Express) => {
  const server = handler.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};
const close = async (server: Server) => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

const ADMIN = 'https://manage.example.com';
const ID = '11111111-1111-4111-8111-111111111111';
const user = { id: 'user-1', email: 'admin@example.com', password_hash: 'x', token_version: 0 };

describe('routes that fail inside a router keep their full pattern', () => {
  const lines: Record<string, unknown>[] = [];
  const metrics = createRequestMetrics();
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const logger = createLogger({ level: () => 'debug', write: (_l, line) => lines.push(JSON.parse(line)) });
    const test = express();
    test.use(createRequestLog({ logger, metrics }));
    const photos = createRouter();
    photos.put('/:id', (_req, _res, next) => next(new Error('db down')));
    const galleries = createRouter();
    galleries.put('/:id', (_req, _res, next) => next(new Error('db down')));
    galleries.route('/:id/cover').put((_req, _res, next) => next(new Error('db down')));
    const api = createRouter();
    api.use('/photos', photos);
    api.use('/galleries', galleries);
    test.use('/api', api);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test.use((_err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      lines.push({ msg: 'handler saw', route: routePattern(req) });
      res.status(500).json({});
    });
    ({ server, base } = await listen(test));
  });
  afterAll(() => close(server));

  it('two routers with the same /:id path log and count as different routes', async () => {
    for (const path of [`/api/photos/${ID}`, `/api/galleries/${ID}`, `/api/galleries/${ID}/cover`]) {
      expect((await fetch(`${base}${path}`, { method: 'PUT' })).status).toBe(500);
    }
    const requests = lines.filter((l) => l.msg === 'request').map((l) => l.route);
    expect(requests).toEqual(['/api/photos/:id', '/api/galleries/:id', '/api/galleries/:id/cover']);
    expect(lines.filter((l) => l.msg === 'handler saw').map((l) => l.route)).toEqual(requests);
    expect(metrics.summarize().routes.map((r) => r.route).sort()).toEqual([
      'PUT /api/galleries/:id',
      'PUT /api/galleries/:id/cover',
      'PUT /api/photos/:id',
    ]);
  });
});

describe('failed requests through the app', () => {
  let server: Server;
  let base: string;
  const logged: Record<string, unknown>[] = [];

  beforeAll(async () => ({ server, base } = await listen(app)));
  afterAll(() => close(server));
  beforeEach(() => {
    logged.length = 0;
    vi.stubEnv('FRONTEND_URL', 'https://example.com');
    vi.stubEnv('LOG_LEVEL', 'info');
    const capture = (line: string) => logged.push(JSON.parse(line));
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
    getUserById.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const cookie = () => `admin_session=${generateToken(user.id, user.email, 0)}`;
  const counted = (route: string) => requestMetrics.summarize().routes.find((r) => r.route === route);

  it('labels a HEIC upload refused by multer with the upload route', async () => {
    getUserById.mockResolvedValue(user);
    const form = new FormData();
    form.append('photo', new Blob([Buffer.from('not really heic')], { type: 'image/heic' }), 'IMG_0001.HEIC');
    const res = await fetch(`${base}/api/photos/upload`, {
      method: 'POST',
      headers: { Cookie: cookie(), Origin: ADMIN },
      body: form,
    });
    expect(res.status).toBe(415);
    expect(logged.find((l) => l.msg === 'request')).toMatchObject({
      method: 'POST',
      route: '/api/photos/upload',
      status: 415,
    });
    expect(counted('POST /api/photos/upload')?.clientErrors).toBeGreaterThanOrEqual(1);
    expect(counted('POST /upload')).toBeUndefined();
  });

  it('labels a database failure in the session check with the full route', async () => {
    getUserById.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    for (const path of [`/api/photos/${ID}`, `/api/galleries/${ID}`]) {
      const res = await fetch(`${base}${path}`, {
        method: 'PUT',
        headers: { Cookie: cookie(), Origin: ADMIN, 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(500);
    }
    expect(logged.filter((l) => l.msg === 'unhandled error').map((l) => l.route)).toEqual([
      '/api/photos/:id',
      '/api/galleries/:id',
    ]);
    expect(logged.filter((l) => l.msg === 'request').map((l) => [l.route, l.status, l.level])).toEqual([
      ['/api/photos/:id', 500, 'error'],
      ['/api/galleries/:id', 500, 'error'],
    ]);
    expect(counted('PUT /api/photos/:id')?.serverErrors).toBeGreaterThanOrEqual(1);
    expect(counted('PUT /api/galleries/:id')?.serverErrors).toBeGreaterThanOrEqual(1);
    expect(counted('PUT /:id')).toBeUndefined();
  });
});
