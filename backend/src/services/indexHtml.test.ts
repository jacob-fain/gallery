import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getIndexHtml, resetIndexHtmlCache } from './indexHtml';

let server: http.Server;
let url = '';
const seen: (string | undefined)[] = [];
let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push(req.headers['if-none-match']);
    respond(req, res);
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/index.html`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(() => {
  seen.length = 0;
  resetIndexHtmlCache();
  vi.unstubAllEnvs();
});

/** Answers like nginx's static file handler: an ETag, and 304 when it matches. */
const staticFile = (etag: string, body: string) => (req: http.IncomingMessage, res: http.ServerResponse) => {
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag }).end();
    return;
  }
  res.writeHead(200, { ETag: etag, 'Content-Type': 'text/html' }).end(body);
};

describe('getIndexHtml', () => {
  it('revalidates every call and reuses the body on a 304', async () => {
    vi.stubEnv('INDEX_HTML_URL', url);
    respond = staticFile('"v1"', '<html>one</html>');
    expect(await getIndexHtml()).toBe('<html>one</html>');
    expect(await getIndexHtml()).toBe('<html>one</html>');
    expect(seen).toEqual([undefined, '"v1"']);
  });

  it('picks up a new file after a deploy', async () => {
    vi.stubEnv('INDEX_HTML_URL', url);
    respond = staticFile('"v1"', '<html>one</html>');
    await getIndexHtml();
    respond = staticFile('"v2"', '<html>two</html>');
    expect(await getIndexHtml()).toBe('<html>two</html>');
  });

  it('throws on any other status', async () => {
    vi.stubEnv('INDEX_HTML_URL', url);
    respond = (_req, res) => res.writeHead(404).end('missing');
    await expect(getIndexHtml()).rejects.toThrow('index.html answered 404');
  });

  it('throws when the frontend cannot be reached', async () => {
    vi.stubEnv('INDEX_HTML_URL', 'http://127.0.0.1:1/index.html');
    await expect(getIndexHtml()).rejects.toThrow();
  });
});
