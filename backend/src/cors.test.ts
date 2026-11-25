import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import app from './app';

const PUBLIC = 'https://example.com';
const ADMIN = 'https://manage.example.com';
const FOREIGN = 'https://attacker.example.net';

// A public route and an admin one. Neither touches the database without a
// session, and CORS answers before either handler runs.
const ROUTES = { public: '/api/health', admin: '/api/auth/me' } as const;

let server: Server;
let base: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => vi.stubEnv('FRONTEND_URL', PUBLIC));
afterEach(() => vi.unstubAllEnvs());

const cors = (res: Response) => ({
  origin: res.headers.get('access-control-allow-origin'),
  credentials: res.headers.get('access-control-allow-credentials'),
});

const get = (path: string, origin: string) => fetch(`${base}${path}`, { headers: { Origin: origin } });

const preflight = (path: string, origin: string) =>
  fetch(`${base}${path}`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });

describe('CORS in production', () => {
  beforeEach(() => vi.stubEnv('NODE_ENV', 'production'));

  for (const [kind, path] of Object.entries(ROUTES)) {
    it(`allows the admin origin with credentials on the ${kind} route`, async () => {
      expect(cors(await get(path, ADMIN))).toEqual({ origin: ADMIN, credentials: 'true' });
      const pre = await preflight(path, ADMIN);
      expect(pre.status).toBe(204);
      expect(cors(pre)).toEqual({ origin: ADMIN, credentials: 'true' });
    });

    it(`gives the public origin no CORS headers on the ${kind} route`, async () => {
      expect(cors(await get(path, PUBLIC))).toEqual({ origin: null, credentials: null });
      expect(cors(await preflight(path, PUBLIC))).toEqual({ origin: null, credentials: null });
    });

    it(`gives a foreign origin no CORS headers on the ${kind} route`, async () => {
      expect(cors(await get(path, FOREIGN))).toEqual({ origin: null, credentials: null });
      expect(cors(await preflight(path, FOREIGN))).toEqual({ origin: null, credentials: null });
    });
  }

  it('still answers a request with no Origin, as same-origin page loads send', async () => {
    const res = await fetch(`${base}${ROUTES.public}`);
    expect(res.status).toBe(200);
    expect(cors(res)).toEqual({ origin: null, credentials: null });
  });
});

describe('CORS in development', () => {
  beforeEach(() => vi.stubEnv('NODE_ENV', 'development'));

  it('lets a local dev host send credentials, since the admin UI runs there', async () => {
    const origin = 'http://localhost:5173';
    expect(cors(await get(ROUTES.admin, origin))).toEqual({ origin, credentials: 'true' });
  });

  it('lets any other origin read without credentials', async () => {
    const origin = 'http://192.168.1.20:5173';
    expect(cors(await get(ROUTES.public, origin))).toEqual({ origin, credentials: null });
  });
});
