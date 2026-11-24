import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const { getUserById } = vi.hoisted(() => ({ getUserById: vi.fn() }));
vi.mock('../services/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/authService')>();
  return { ...actual, getUserById: (id: string) => getUserById(id) };
});

import app from '../app';
import { generateToken } from '../services/authService';
import { createRequestMetrics } from '../services/requestMetrics';
import { latestMigration, metricsSnapshot } from './metricsController';
import { listMigrations } from '../migrate';
import type { ApiResponse } from '../types';
import { readJson } from '../../test/json';

type MetricsBody = ReturnType<typeof metricsSnapshot> & { migration: string | null };

const user = { id: 'user-1', email: 'admin@example.com', password_hash: 'x', token_version: 0 };

describe('metricsSnapshot', () => {
  it('reports build, uptime, pool, upload queue and request summary', () => {
    const requests = createRequestMetrics();
    requests.record({ method: 'GET', route: '/api/featured', status: 200, durationMs: 12 });
    const snap = metricsSnapshot({
      db: { totalCount: 4, idleCount: 3, waitingCount: 1 },
      uploads: { running: 2, queued: 5, limit: 2 },
      requests,
      env: { GIT_SHA: 'abc123', APP_VERSION: 'v1.2.3' },
      uptimeSeconds: 61.4,
      memory: { rss: 100, heapUsed: 50, heapTotal: 0, external: 0, arrayBuffers: 0 },
    });
    expect(snap).toEqual({
      build: { id: 'dev', commit: 'abc123', version: 'v1.2.3' },
      uptimeSeconds: 61,
      memory: { rssBytes: 100, heapUsedBytes: 50 },
      db: { total: 4, idle: 3, waiting: 1 },
      uploads: { running: 2, queued: 5, limit: 2 },
      requests: expect.objectContaining({ total: 1, serverErrors: 0 }),
    });
    expect(snap.requests.routes[0]).toMatchObject({ route: 'GET /api/featured', p50Ms: 12, p95Ms: 12 });
  });

  it('reports a missing commit and version as null', () => {
    expect(metricsSnapshot({ env: {} }).build).toMatchObject({ commit: null, version: null });
  });
});

describe('GET /api/admin/metrics', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    getUserById.mockReset();
    getUserById.mockResolvedValue(user);
  });

  it('refuses a request without an admin session', async () => {
    const res = await fetch(`${base}/admin/metrics`);
    expect(res.status).toBe(401);
  });

  it('answers the admin with the snapshot', async () => {
    const res = await fetch(`${base}/admin/metrics`, {
      headers: { Cookie: `admin_session=${generateToken(user.id, user.email, 0)}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const body = await readJson<ApiResponse<MetricsBody>>(res);
    expect(body.success).toBe(true);
    expect(Object.keys(body.data!).sort()).toEqual([
      'build', 'db', 'memory', 'migration', 'requests', 'uploads', 'uptimeSeconds',
    ]);
    expect(body.data?.uploads).toMatchObject({ limit: 2 });
    // Unit runs have no database, which reads as an unknown schema, not a failure.
    expect(body.data?.migration).toBe(
      process.env.TEST_DATABASE_URL ? listMigrations().at(-1) : null
    );
  });
});

describe('latestMigration', () => {
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))('reads the newest applied migration', async () => {
    // The test database is built by the migration runner, so it records
    // every migration that ships.
    expect(await latestMigration()).toBe(listMigrations().at(-1));
  });
});
