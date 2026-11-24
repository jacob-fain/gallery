import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import app from '../app';
import { resetRateLimits } from '../middleware/rateLimit';
import { clientErrorMetrics } from '../services/clientErrorMetrics';
import { LIMITS, parseClientError } from './clientErrors';

const report = (overrides: Record<string, unknown> = {}) => ({
  source: 'error',
  message: 'TypeError: x is undefined',
  stack: 'TypeError: x is undefined\n    at Gallery (https://example.com/assets/Gallery-abc.js:1:200)',
  url: '/gallery/wedding',
  release: '3f2a9c0d1e4b5a67',
  userAgent: 'Mozilla/5.0 test',
  ...overrides,
});

describe('parseClientError', () => {
  it('keeps the known fields and maps url to a path', () => {
    expect(parseClientError(report())).toEqual({
      source: 'error',
      message: 'TypeError: x is undefined',
      stack: report().stack,
      path: '/gallery/wedding',
      release: '3f2a9c0d1e4b5a67',
      userAgent: 'Mozilla/5.0 test',
    });
  });

  it('cuts the query string and hash from the url', () => {
    expect(parseClientError(report({ url: '/gallery/x?access=secret#top' }))?.path).toBe('/gallery/x');
    expect(parseClientError(report({ url: '/gallery/x#a?b' }))?.path).toBe('/gallery/x');
  });

  it('truncates long fields', () => {
    const parsed = parseClientError(
      report({ message: 'm'.repeat(2000), stack: 's'.repeat(9000), url: `/${'p'.repeat(900)}`, userAgent: 'u'.repeat(900) })
    );
    expect(parsed?.message).toHaveLength(LIMITS.message);
    expect(parsed?.stack).toHaveLength(LIMITS.stack);
    expect(parsed?.path).toHaveLength(LIMITS.path);
    expect(parsed?.userAgent).toHaveLength(LIMITS.userAgent);
  });

  it('refuses bodies that are not reports', () => {
    expect(parseClientError(null)).toBeNull();
    expect(parseClientError('text')).toBeNull();
    expect(parseClientError([report()])).toBeNull();
    expect(parseClientError(report({ source: 'other' }))).toBeNull();
    expect(parseClientError(report({ message: '' }))).toBeNull();
    expect(parseClientError(report({ message: 42 }))).toBeNull();
    expect(parseClientError(report({ url: 'https://evil.example/x' }))).toBeNull();
    expect(parseClientError(report({ stack: { a: 1 } }))).toBeNull();
  });

  it('drops a malformed release and falls back to the request user agent', () => {
    const parsed = parseClientError(report({ release: '<script>', userAgent: undefined }), 'Header UA');
    expect(parsed?.release).toBeUndefined();
    expect(parsed?.userAgent).toBe('Header UA');
  });

  it('ignores fields it does not know', () => {
    expect(parseClientError(report({ cookie: 'admin_session=abc', form: { password: 'x' } }))).not.toHaveProperty('cookie');
  });
});

describe('POST /api/client-errors', () => {
  let server: Server;
  let base = '';
  let lines: string[] = [];
  let previousLevel: string | undefined;

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
    resetRateLimits();
    lines = [];
    previousLevel = process.env.LOG_LEVEL;
    // Request lines log at info; only warnings and errors are captured.
    process.env.LOG_LEVEL = 'warn';
    vi.spyOn(console, 'error').mockImplementation((line: string) => void lines.push(line));
  });
  afterEach(() => {
    process.env.LOG_LEVEL = previousLevel;
    vi.restoreAllMocks();
  });

  const post = (body: string, contentType = 'text/plain;charset=UTF-8') =>
    fetch(`${base}/client-errors`, { method: 'POST', headers: { 'Content-Type': contentType }, body });

  it('logs one warning, answers 204 with no-store, and counts the report', async () => {
    const before = clientErrorMetrics.summarize().count;
    const res = await post(JSON.stringify(report()));
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({
      level: 'warn',
      msg: 'client error',
      source: 'error',
      message: 'TypeError: x is undefined',
      path: '/gallery/wedding',
      release: '3f2a9c0d1e4b5a67',
      userAgent: 'Mozilla/5.0 test',
    });
    expect(entry.requestId).toEqual(expect.any(String));
    expect(clientErrorMetrics.summarize().count).toBe(before + 1);
  });

  it('accepts application/json as well as the text/plain a beacon sends', async () => {
    const res = await post(JSON.stringify(report()), 'application/json');
    expect(res.status).toBe(204);
  });

  it('never logs a query string, wherever the client put one', async () => {
    const res = await post(
      JSON.stringify(
        report({
          url: '/gallery/private?access=tok123#x',
          message: 'Failed to load https://bucket.s3.amazonaws.com/p.jpg?X-Amz-Signature=sig456',
          stack: 'Error\n    at /gallery/private?access=tok789:1:2',
        })
      )
    );
    expect(res.status).toBe(204);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/tok123|sig456|tok789|access=|X-Amz/);
    expect(JSON.parse(lines[0]).path).toBe('/gallery/private');
  });

  it('refuses an invalid report without logging it', async () => {
    const res = await post(JSON.stringify({ source: 'error', url: '/' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(lines).toHaveLength(0);
  });

  it('refuses a body that is not JSON', async () => {
    expect((await post('not json')).status).toBe(400);
    expect(lines).toHaveLength(0);
  });

  it('refuses a body over the size limit', async () => {
    const res = await post(JSON.stringify(report({ stack: 's'.repeat(9 * 1024) })));
    expect(res.status).toBe(413);
    expect(lines).toHaveLength(0);
  });

  it('drops reports past the per-visitor limit', async () => {
    for (let i = 0; i < 30; i++) {
      expect((await post(JSON.stringify(report({ message: `e${i}` })))).status).toBe(204);
    }
    expect(lines).toHaveLength(30);
    const res = await post(JSON.stringify(report({ message: 'one too many' })));
    expect(res.status).toBe(204);
    expect(lines).toHaveLength(30);
  });

  it('needs no session', async () => {
    const res = await fetch(`${base}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: 'https://example.com' },
      body: JSON.stringify(report()),
    });
    expect(res.status).toBe(204);
  });
});
