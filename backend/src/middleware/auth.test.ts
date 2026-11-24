import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { authMiddleware } from './auth';
import { generateToken, generateGalleryAccessToken } from '../services/authService';

const { getUserById } = vi.hoisted(() => ({ getUserById: vi.fn() }));
vi.mock('../services/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/authService')>();
  return { ...actual, getUserById: (id: string) => getUserById(id) };
});

const call = async (authorization?: string) => {
  const req = { headers: authorization ? { authorization } : {} } as Request;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
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
    getUserById.mockResolvedValue({ id: 'user-1', email: 'admin@example.com' });
    const { req, next, res } = await call(`Bearer ${generateToken('user-1', 'admin@example.com')}`);
    expect(next).toHaveBeenCalledWith();
    expect(res.statusCode).toBe(200);
    expect(req.user).toEqual({ userId: 'user-1', email: 'admin@example.com' });
  });

  it('refuses a gallery access token', async () => {
    const { next, res } = await call(`Bearer ${generateGalleryAccessToken('gallery-1', 'wedding')}`);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('refuses a valid token for a deleted user', async () => {
    getUserById.mockResolvedValue(null);
    const { next, res } = await call(`Bearer ${generateToken('gone', 'gone@example.com')}`);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('refuses a missing or malformed header', async () => {
    expect((await call()).res.statusCode).toBe(401);
    expect((await call('Token abc')).res.statusCode).toBe(401);
  });

  it('passes a database failure to the error handler instead of admitting', async () => {
    const failure = new Error('db down');
    getUserById.mockRejectedValue(failure);
    const { next, req } = await call(`Bearer ${generateToken('user-1', 'admin@example.com')}`);
    expect(next).toHaveBeenCalledWith(failure);
    expect(req.user).toBeUndefined();
  });
});
