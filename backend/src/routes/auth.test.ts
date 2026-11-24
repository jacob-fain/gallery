import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const { getUserByEmail, getUserById, revokeTokens } = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
  revokeTokens: vi.fn(),
}));
vi.mock('../services/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/authService')>();
  return {
    ...actual,
    getUserByEmail: (email: string) => getUserByEmail(email),
    getUserById: (id: string) => getUserById(id),
    revokeTokens: (id: string) => revokeTokens(id),
    verifyPassword: async (password: string) => password === 'right',
  };
});

import app from '../app';
import { generateToken } from '../services/authService';

const ADMIN = 'https://manage.example.com';
const user = { id: 'user-1', email: 'admin@example.com', password_hash: 'x', token_version: 0 };

describe('admin session cookie through the app', () => {
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
    vi.stubEnv('FRONTEND_URL', 'https://example.com');
    vi.stubEnv('NODE_ENV', 'production');
    vi.clearAllMocks();
    getUserByEmail.mockResolvedValue(user);
    getUserById.mockResolvedValue(user);
    revokeTokens.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  const login = (password: string, origin = ADMIN) =>
    fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: user.email, password }),
    });
  const cookie = () => `admin_session=${generateToken(user.id, user.email, 0)}`;

  it('login sets a host-only, httpOnly, Secure, SameSite=Strict cookie on /api and returns no token', async () => {
    const res = await login('right');
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie')!;
    const [pair, ...attributes] = setCookie.split(/;\s*/);
    expect(pair).toMatch(/^admin_session=[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(attributes).toEqual(
      expect.arrayContaining(['Max-Age=86400', 'Path=/api', 'HttpOnly', 'Secure', 'SameSite=Strict'])
    );
    expect(setCookie).not.toMatch(/Domain=/i);
    const body = await res.json();
    expect(body.data).toEqual({ user: { id: user.id, email: user.email } });
  });

  it('a failed login sets no cookie', async () => {
    const res = await login('wrong');
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('login from a foreign origin is refused', async () => {
    const res = await login('right', 'https://evil.test');
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('logout revokes the sessions and clears the cookie', async () => {
    const res = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie(), Origin: ADMIN },
    });
    expect(res.status).toBe(200);
    expect(revokeTokens).toHaveBeenCalledWith(user.id);
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^admin_session=;/);
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(setCookie).toMatch(/Path=\/api/);
  });

  it('a valid cookie with a foreign Origin is refused', async () => {
    const res = await fetch(`${base}/galleries`, {
      method: 'POST',
      headers: { Cookie: cookie(), Origin: 'https://evil.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(res.status).toBe(403);
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('a request without the cookie is 401', async () => {
    const res = await fetch(`${base}/auth/me`);
    expect(res.status).toBe(401);
  });

  it('a valid cookie authenticates a read', async () => {
    const res = await fetch(`${base}/auth/me`, { headers: { Cookie: cookie() } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: user.id, email: user.email });
  });
});
