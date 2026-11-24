import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import app from '../app';
import { isUuid, validateBodyIds, MAX_IDS, JSON_BODY_LIMIT } from './validateIds';

describe('isUuid', () => {
  it('accepts UUIDs and rejects everything else', () => {
    expect(isUuid('3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b')).toBe(true);
    expect(isUuid('3F2B8C1E-9A4D-4E6F-8B2A-1C3D5E7F9A0B')).toBe(true);
    for (const bad of ['abc', '', '3f2b8c1e-9a4d-4e6f-8b2a', "1' or '1'='1", 42, null, undefined, ['x']]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});

// Requests with malformed ids are refused before any handler or query runs,
// so these hit the real app with no database behind it.
describe('malformed ids through the app', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(async () => {
    // fetch keeps connections alive, and close() waits for every one.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each([
    ['GET', '/photos/not-a-uuid'],
    ['GET', '/photos/not-a-uuid/download'],
    ['POST', '/photos/not-a-uuid/view'],
    ['POST', '/photos/not-a-uuid/download-track'],
  ])('%s %s answers 404, not 500', async (method, path) => {
    const res = await fetch(base + path, { method });
    expect(res.status).toBe(404);
    // Identical to a well-formed id that names no photo.
    expect(await res.json()).toEqual({ success: false, error: 'Photo not found' });
  });

  it('admits a full list of ids past the body parser', async () => {
    // Body parsing runs before auth: an oversized body would answer 413,
    // an accepted one reaches auth, whose origin check answers 403 to a
    // write that carries no admin Origin.
    const ids = Array(MAX_IDS).fill('3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b');
    const res = await fetch(base + '/photos/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gallery_id: ids[0], photo_ids: ids }),
    });
    expect(res.status).toBe(403);
  });
});

describe('validateBodyIds', () => {
  const run = (rules: Parameters<typeof validateBodyIds>[0], body: unknown) => {
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(b: unknown) {
        this.body = b;
        return this;
      },
    };
    let passed = false;
    validateBodyIds(rules)({ body } as never, res as never, () => {
      passed = true;
    });
    return { passed, res };
  };
  const id = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';

  it('passes valid ids and lists', () => {
    expect(run({ photo_id: 'uuid', photo_ids: 'uuid[]' }, { photo_id: id, photo_ids: [id, id] }).passed).toBe(true);
  });

  it('treats an absent, null or empty optional id as allowed', () => {
    for (const galleryId of [undefined, null, '']) {
      expect(run({ galleryId: 'uuid?' }, { galleryId }).passed).toBe(true);
    }
  });

  it('refuses a malformed required id with 400 naming the field', () => {
    const { passed, res } = run({ target_gallery_id: 'uuid' }, { target_gallery_id: 'nope' });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'target_gallery_id must be a valid id' });
  });

  it('accepts a whole large gallery, up to the cap', () => {
    // Reorder and shuffle send every photo id in the gallery.
    expect(run({ photo_ids: 'uuid[]' }, { photo_ids: Array(MAX_IDS).fill(id) }).passed).toBe(true);
  });

  it('fits a full list of ids inside the JSON body limit', () => {
    const bytes = Buffer.byteLength(JSON.stringify({ gallery_id: id, photo_ids: Array(MAX_IDS).fill(id) }));
    expect(bytes).toBeLessThan(parseInt(JSON_BODY_LIMIT, 10) * 1024);
  });

  it('refuses empty, oversized or impure id lists', () => {
    expect(run({ photo_ids: 'uuid[]' }, { photo_ids: [] }).passed).toBe(false);
    expect(run({ photo_ids: 'uuid[]' }, { photo_ids: [id, 'x'] }).passed).toBe(false);
    expect(run({ photo_ids: 'uuid[]' }, { photo_ids: Array(MAX_IDS + 1).fill(id) }).passed).toBe(false);
    expect(run({ photo_ids: 'uuid[]' }, { photo_ids: id }).passed).toBe(false);
  });
});
