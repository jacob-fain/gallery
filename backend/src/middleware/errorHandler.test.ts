import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type { Request, Response } from 'express';
import app from '../app';
import { createErrorHandler } from './errorHandler';

const fakeRes = () => {
  const out = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { out, res: res as unknown as Response };
};

describe('createErrorHandler', () => {
  const run = (env: NodeJS.ProcessEnv, err: Error) => {
    const { out, res } = fakeRes();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    createErrorHandler(env)(err, {} as Request, res, () => {});
    return out;
  };

  it('shows an unexpected error message only in development', () => {
    const err = new Error('relation "photos" does not exist');
    expect(run({ NODE_ENV: 'development' }, err)).toEqual({
      status: 500,
      body: { success: false, error: 'relation "photos" does not exist' },
    });
    for (const NODE_ENV of ['production', 'staging', 'test', undefined]) {
      expect(run({ NODE_ENV }, err)).toEqual({
        status: 500,
        body: { success: false, error: 'Internal server error' },
      });
    }
  });

  it('passes other client errors from the body parser through with their status', () => {
    const err = Object.assign(new Error('unsupported charset "X"'), {
      status: 415,
      type: 'charset.unsupported',
    });
    expect(run({}, err)).toEqual({
      status: 415,
      body: { success: false, error: 'Invalid request body' },
    });
  });
});

describe('request body errors through the app', () => {
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

  const post = (body: string) =>
    fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

  it('answers malformed JSON with 400', async () => {
    const res = await post('{"email":');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Request body is not valid JSON' });
  });

  it('answers an oversized body with 413', async () => {
    const res = await post(JSON.stringify({ pad: 'x'.repeat(300 * 1024) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ success: false, error: 'Request body is too large' });
  });
});
