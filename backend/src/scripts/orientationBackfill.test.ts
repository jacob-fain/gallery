import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { planFor, run, type Deps, type PhotoRow } from './orientationBackfill';
import { processImage } from '../services/imageService';

const CUTOFF = new Date('2026-12-01T00:00:00Z');
const BEFORE = new Date('2026-07-01T00:00:00Z');
const AFTER = new Date('2026-12-02T00:00:00Z');

const jpeg = (orientation: number, width = 300, height = 200) =>
  sharp({ create: { width, height, channels: 3, background: '#468' } })
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer();

const row = (id: string, width: number, height: number, uploaded_at = BEFORE): PhotoRow => ({
  id,
  s3_key: `o/${id}`,
  s3_web_key: `w/${id}`,
  s3_thumbnail_key: `t/${id}`,
  width,
  height,
  uploaded_at,
});

describe('planFor', () => {
  it('swaps the size for quarter turns', () => {
    expect(planFor(row('a', 300, 200), { orientation: 6, width: 300, height: 200 }, CUTOFF)).toMatchObject({
      to: { width: 200, height: 300 },
    });
  });

  it('regenerates upside-down and mirrored photos at the same size', () => {
    for (const orientation of [2, 3, 4]) {
      expect(planFor(row('a', 300, 200), { orientation, width: 300, height: 200 }, CUTOFF)).toMatchObject({
        orientation,
        to: { width: 300, height: 200 },
      });
    }
  });

  it('skips upright photos and anything uploaded after the cutoff', () => {
    expect(planFor(row('a', 300, 200), { orientation: 1, width: 300, height: 200 }, CUTOFF)).toBeNull();
    expect(planFor(row('a', 300, 200, AFTER), { orientation: 6, width: 300, height: 200 }, CUTOFF)).toBeNull();
  });
});

function fakes(files: Record<string, Buffer>, rows: PhotoRow[], failUpload?: string) {
  const writes: string[] = [];
  const sizes: Record<string, [number, number]> = {};
  const deps: Deps = {
    listPhotos: async () => rows,
    readHead: async (k) => files[k].subarray(0, 256 * 1024),
    readAll: async (k) => files[k],
    upload: async (buffer, key) => {
      if (key === failUpload) throw new Error('upload failed');
      writes.push(key);
      files[key] = buffer;
    },
    updateSize: async (id, w, h) => {
      sizes[id] = [w, h];
    },
    processImage,
    log: () => {},
  };
  return { deps, writes, sizes };
}

describe('run', () => {
  it('writes nothing on a dry run', async () => {
    const files = { 'o/a': await jpeg(6), 'o/b': await jpeg(1) };
    const { deps, writes, sizes } = fakes(files, [row('a', 300, 200), row('b', 300, 200)]);
    const result = await run(deps, false, CUTOFF);
    expect(result.plans.map((p) => p.id)).toEqual(['a']);
    expect(writes).toEqual([]);
    expect(sizes).toEqual({});
  });

  it('regenerates only derived files on apply, never the original', async () => {
    const original = await jpeg(8);
    const files: Record<string, Buffer> = { 'o/a': original };
    const { deps, writes, sizes } = fakes(files, [row('a', 300, 200)]);
    await run(deps, true, CUTOFF);
    expect(writes.sort()).toEqual(['t/a', 'w/a']);
    expect(files['o/a'].equals(original)).toBe(true);
    expect(sizes.a).toEqual([200, 300]);
    expect(await sharp(files['w/a']).metadata()).toMatchObject({ width: 200, height: 300 });
  });

  it('turns an upside-down photo right way up', async () => {
    // Dark top half, light bottom half, stored upside down (orientation 3).
    const top = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#000' } }).png().toBuffer();
    const stored = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } })
      .composite([{ input: top, top: 20, left: 0 }])
      .withMetadata({ orientation: 3 })
      .jpeg()
      .toBuffer();
    const files: Record<string, Buffer> = { 'o/a': stored };
    const { deps } = fakes(files, [row('a', 40, 40)]);
    await run(deps, true, CUTOFF);
    const { data } = await sharp(files['w/a']).raw().toBuffer({ resolveWithObject: true });
    // The first pixel is the dark half now on top.
    expect(data[0]).toBeLessThan(60);
  });

  it('keeps going past a failing photo and counts it', async () => {
    const files = { 'o/a': await jpeg(6), 'o/b': await jpeg(6) };
    const { deps, sizes } = fakes(files, [row('a', 300, 200), row('b', 300, 200)], 'w/a');
    const result = await run(deps, true, CUTOFF);
    expect(result.failed).toBe(1);
    expect(sizes).toEqual({ b: [200, 300] });
  });

  it('refuses a row whose derived key would overwrite the original', async () => {
    const original = await jpeg(6);
    const files: Record<string, Buffer> = { 'o/a': original };
    const bad = { ...row('a', 300, 200), s3_web_key: 'o/a' };
    const { deps, writes } = fakes(files, [bad]);
    const result = await run(deps, true, CUTOFF);
    expect(result.failed).toBe(1);
    expect(writes).toEqual([]);
    expect(files['o/a'].equals(original)).toBe(true);
  });

  it('skips a photo whose original cannot be read and keeps going', async () => {
    const files = { 'o/a': Buffer.from('not an image'), 'o/b': await jpeg(6) };
    const { deps } = fakes(files, [row('a', 1, 1), row('b', 300, 200)]);
    const result = await run(deps, false, CUTOFF);
    expect(result.unreadable).toBe(1);
    expect(result.plans.map((p) => p.id)).toEqual(['b']);
  });
});
