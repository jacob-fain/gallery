import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { storedFilename, upload } from './upload';

// A multipart body exactly as a browser sends it: the filename parameter is
// raw UTF-8 bytes with no charset declared.
const multipart = (filename: string, contentType: string) => {
  const boundary = '----test-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="`),
    Buffer.from(filename, 'utf8'),
    Buffer.from(`"\r\nContent-Type: ${contentType}\r\n\r\nbytes\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
};

describe('upload middleware', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.post('/up', upload.single('photo'), (req, res) => {
      res.json({ name: req.file?.originalname });
    });
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(415).json({ error: err.message });
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (filename: string, contentType = 'image/jpeg') =>
    fetch(`${base}/up`, { method: 'POST', ...multipart(filename, contentType) });

  it('decodes a non-ASCII filename as UTF-8', async () => {
    const res = await post('café_東京.jpg');
    expect(await res.json()).toEqual({ name: 'café_東京.jpg' });
  });

  it('accepts an untyped file by its image extension', async () => {
    const res = await post('IMG_0001.JPG', 'application/octet-stream');
    expect(res.status).toBe(200);
  });

  it('rejects an untyped file with any other extension, HEIC included', async () => {
    for (const name of ['notes.txt', 'IMG_0001.HEIC']) {
      const res = await post(name, 'application/octet-stream');
      expect(res.status).toBe(415);
    }
  });
});

describe('storedFilename', () => {
  it('keeps a name of 255 characters or fewer', () => {
    const name = `${'東'.repeat(251)}.jpg`;
    expect(storedFilename(name)).toBe(name);
  });

  it('cuts a long name to 255 characters and keeps the extension', () => {
    const stored = storedFilename(`${'東'.repeat(300)}.jpeg`);
    expect(Array.from(stored)).toHaveLength(255);
    expect(stored.endsWith('東.jpeg')).toBe(true);
  });

  it('cuts a long name with no usable extension as a whole', () => {
    const stored = storedFilename('a'.repeat(300));
    expect(stored).toBe('a'.repeat(255));
  });
});
