import crypto from 'crypto';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { afterAll, beforeAll } from 'vitest';
import { query } from '../src/config/db';
import { generateToken } from '../src/services/authService';
import app from '../src/app';

const ADMIN_ORIGIN = 'https://manage.example.com';

export interface ApiResponse {
  status: number;
  headers: Headers;
  // Parsed JSON, or null for a body that is not JSON.
  body: any;
  raw: Buffer;
}

export interface RequestOptions {
  body?: unknown;
  // A multipart body, sent as it is instead of body.
  form?: FormData;
  // Send the admin Origin and, unless session is false, the admin session
  // cookie (default true).
  admin?: boolean;
  session?: boolean;
  headers?: Record<string, string>;
  // 'manual' returns a redirect instead of following it.
  redirect?: 'follow' | 'manual';
}

/**
 * Serves the real app on a random port for one test file, with an admin user
 * in the test database whose session the requests can carry. FRONTEND_URL is
 * set so the admin Origin check has an admin site to compare against.
 */
export function useAppServer() {
  let server: Server;
  let base = '';
  let cookie = '';
  let userId = '';
  let previousFrontend: string | undefined;

  beforeAll(async () => {
    previousFrontend = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://example.com';
    const email = `admin-${crypto.randomBytes(4).toString('hex')}@example.com`;
    const { rows } = await query(
      `INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`,
      [email]
    );
    userId = rows[0].id;
    cookie = `admin_session=${generateToken(userId, email, 0)}`;
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await query(`DELETE FROM users WHERE id = $1`, [userId]);
    if (previousFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontend;
  });

  const request = async (
    method: string,
    path: string,
    { body, form, admin = true, session = admin, headers: extra = {}, redirect }: RequestOptions = {}
  ): Promise<ApiResponse> => {
    const headers: Record<string, string> = { ...extra };
    if (admin) headers.Origin = ADMIN_ORIGIN;
    if (session) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      redirect,
    });
    const raw = Buffer.from(await res.arrayBuffer());
    let parsed = null;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      // A ZIP or an empty body.
    }
    return { status: res.status, headers: res.headers, body: parsed, raw };
  };

  return { request };
}
