import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware } from './auth';
import { generateToken, generateGalleryAccessToken } from '../services/authService';

const { getUserById } = vi.hoisted(() => ({ getUserById: vi.fn() }));
vi.mock('../services/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/authService')>();
  return { ...actual, getUserById: (id: string) => getUserById(id) };
});

const call = async (
  token?: string,
  { method = 'GET', origin, authorization }: { method?: string; origin?: string; authorization?: string } = {}
) => {
  const headers: Record<string, string> = {};
  if (authorization) headers.authorization = authorization;
  if (token !== undefined) headers.cookie = `theme=dark; admin_session=${token}`;
  if (origin) headers.origin = origin;
  const req = { method, headers } as unknown as Request;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    cleared: [] as string[],
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    clearCookie(name: string) {
      this.cleared.push(name);
      return this;
    },
  };
  const next = vi.fn() as unknown as NextFunction;
  await authMiddleware(req, res as unknown as Response, next);
  return { req, res, next: next as unknown as ReturnType<typeof vi.fn> };
};

describe('authMiddleware', () => {
  beforeEach(() => {
    getUserById.mockReset();
  });

  it('admits an admin token whose user exists', async () => {
    getUserById.mockResolvedValue({ id: 'user-1', email: 'admin@example.com', token_version: 0 });
    const { req, next, res } = await call(generateToken('user-1', 'admin@example.com', 0));
    expect(next).toHaveBeenCalledWith();
    expect(res.statusCode).toBe(200);
    expect(req.user).toEqual({ userId: 'user-1', email: 'admin@example.com', tokenVersion: 0 });
  });

  it('refuses a gallery access token', async () => {
    const { next, res } = await call(generateGalleryAccessToken('gallery-1', 'wedding'));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('refuses a token issued before the user revoked their sessions', async () => {
    getUserById.mockResolvedValue({ id: 'user-1', email: 'admin@example.com', token_version: 1 });
    const { next, res } = await call(generateToken('user-1', 'admin@example.com', 0));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('refuses a token from before token versions existed', async () => {
    getUserById.mockResolvedValue({ id: 'user-1', email: 'admin@example.com', token_version: 0 });
    const legacy = jwt.sign({ userId: 'user-1', email: 'admin@example.com' }, process.env.JWT_SECRET!, {
      algorithm: 'HS256',
      issuer: 'gallery-api',
      audience: 'admin',
    });
    const { next, res } = await call(legacy);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('refuses a valid token for a deleted user', async () => {
    getUserById.mockResolvedValue(null);
    const { next, res } = await call(generateToken('gone', 'gone@example.com', 0));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('refuses a request without the session cookie', async () => {
    const { res, next } = await call();
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(res.cleared).toEqual([]);
  });

  it('refuses and clears a cookie that is not a valid token', async () => {
    const { res, next } = await call('not-a-jwt');
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(res.cleared).toEqual(['admin_session']);
  });

  it('ignores an Authorization header', async () => {
    const token = generateToken('user-1', 'admin@example.com', 0);
    const { res, next } = await call(undefined, { authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  describe('origin check', () => {
    const token = () => generateToken('user-1', 'admin@example.com', 0);
    beforeEach(() => {
      vi.stubEnv('FRONTEND_URL', 'https://example.com');
      getUserById.mockResolvedValue({ id: 'user-1', email: 'admin@example.com', token_version: 0 });
    });
    afterEach(() => vi.unstubAllEnvs());

    it('admits a write from the admin origin', async () => {
      const { next } = await call(token(), { method: 'PUT', origin: 'https://manage.example.com' });
      expect(next).toHaveBeenCalledWith();
    });

    it('refuses a write with a valid cookie from a foreign origin', async () => {
      for (const origin of ['https://evil.test', 'https://example.com', 'null']) {
        const { res, next } = await call(token(), { method: 'POST', origin });
        expect(res.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
      }
    });

    it('refuses a read that names a foreign origin', async () => {
      const { res, next } = await call(token(), { origin: 'https://example.com' });
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('refuses a write with no Origin or Referer, and admits a same-origin read', async () => {
      expect((await call(token(), { method: 'DELETE' })).res.statusCode).toBe(403);
      expect((await call(token())).next).toHaveBeenCalledWith();
    });

    it('accepts localhost origins only in development', async () => {
      const write = () => call(token(), { method: 'PUT', origin: 'http://localhost:5173' });
      expect((await write()).res.statusCode).toBe(403);
      vi.stubEnv('NODE_ENV', 'development');
      expect((await write()).next).toHaveBeenCalledWith();
    });
  });

  it('passes a database failure to the error handler instead of admitting', async () => {
    const failure = new Error('db down');
    getUserById.mockRejectedValue(failure);
    const { next, req } = await call(generateToken('user-1', 'admin@example.com', 0));
    expect(next).toHaveBeenCalledWith(failure);
    expect(req.user).toBeUndefined();
  });
});
