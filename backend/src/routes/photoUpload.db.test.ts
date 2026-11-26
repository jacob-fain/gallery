import crypto from 'crypto';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { uploadFile } = vi.hoisted(() => ({ uploadFile: vi.fn() }));
vi.mock('../services/s3Service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/s3Service')>()),
  getSignedUrl: async (key: string) => `https://signed.example/${key}`,
  uploadFile: (...args: unknown[]) => uploadFile(...args),
  deleteFiles: async () => 0,
}));

import { query } from '../config/db';
import { useAppServer } from '../../test/appServer';
import { useFixtures } from '../../test/fixtures';

const db = process.env.TEST_DATABASE_URL;

// A JPEG no other test uses, so its content hash is new to the database.
const uniqueJpeg = () =>
  sharp({
    create: {
      width: 24,
      height: 16,
      channels: 3,
      background: { r: crypto.randomInt(256), g: crypto.randomInt(256), b: crypto.randomInt(256) },
    },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { ImageDescription: crypto.randomBytes(8).toString('hex') } } })
    .toBuffer();

const sha256 = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

describe.skipIf(!db)('POST /photos/upload retried after a lost answer (database)', () => {
  const { request } = useAppServer();
  const fixtures = useFixtures();
  const hashes: string[] = [];

  afterAll(async () => {
    if (hashes.length) await query(`DELETE FROM photos WHERE content_hash = ANY($1)`, [hashes]);
  });

  beforeEach(() => {
    uploadFile.mockReset();
    uploadFile.mockResolvedValue(undefined);
  });

  const send = (bytes: Buffer, galleryId: string) => {
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'IMG_0001.jpg');
    form.append('galleryId', galleryId);
    return request('POST', '/photos/upload', { form });
  };

  const rowsFor = async (hash: string) =>
    (await query(`SELECT id, gallery_id FROM photos WHERE content_hash = $1`, [hash])).rows;

  it('answers the retry 409 naming the stored photo, and stores no second copy', async () => {
    const g = await fixtures.gallery();
    const bytes = await uniqueJpeg();
    const hash = sha256(bytes);
    hashes.push(hash);

    // The server stores the photo; the client never sees this answer.
    const first = await send(bytes, g.id);
    expect(first.status).toBe(201);
    expect(uploadFile).toHaveBeenCalledTimes(3);

    // What the client asks before sending again finds it.
    const check = await request('POST', '/photos/admin/check-duplicates', { body: { hashes: [hash] } });
    expect(check.body.data[hash]).toMatchObject({ id: first.body.data.id, gallery_id: g.id });

    // A retry that sends the bytes anyway is refused before anything is stored.
    const retry = await send(bytes, g.id);
    expect(retry.status).toBe(409);
    expect(retry.body).toMatchObject({
      success: false,
      error: 'Already uploaded as IMG_0001.jpg (needs review)',
      existing: { id: first.body.data.id, gallery_id: g.id },
    });
    expect(uploadFile).toHaveBeenCalledTimes(3);
    expect(await rowsFor(hash)).toEqual([{ id: first.body.data.id, gallery_id: g.id }]);
  });

  it('stores one photo when a retry arrives while the first attempt is still being saved', async () => {
    const g = await fixtures.gallery();
    const bytes = await uniqueJpeg();
    const hash = sha256(bytes);
    hashes.push(hash);

    // Both requests pass the duplicate check before either inserts: the
    // unique content hash index decides, and the loser answers 409.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let arrived = 0;
    uploadFile.mockImplementation(async () => {
      arrived += 1;
      await gate;
    });
    const both = Promise.all([send(bytes, g.id), send(bytes, g.id)]);
    await vi.waitFor(() => expect(arrived).toBe(6));
    release();
    const [a, b] = await both;

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const stored = a.status === 201 ? a : b;
    const refused = a.status === 201 ? b : a;
    expect(refused.body.existing).toEqual({ id: stored.body.data.id, gallery_id: g.id });
    expect(await rowsFor(hash)).toHaveLength(1);
  });
});
