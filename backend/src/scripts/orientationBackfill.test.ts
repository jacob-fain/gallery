import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { planFor, run, type Deps, type PhotoRow } from './orientationBackfill';
import { processImage } from '../services/imageService';

const jpeg = (orientation: number) =>
  sharp({ create: { width: 300, height: 200, channels: 3, background: '#468' } })
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer();

const row = (id: string, width: number, height: number): PhotoRow => ({
  id,
  s3_key: `o/${id}`,
  s3_web_key: `w/${id}`,
  s3_thumbnail_key: `t/${id}`,
  width,
  height,
});

describe('planFor', () => {
  it('fixes a quarter-turn photo recorded with stored dimensions', () => {
    expect(planFor(row('a', 300, 200), { orientation: 6, width: 300, height: 200 })).toMatchObject({
      to: { width: 200, height: 300 },
    });
  });

  it('skips an upright photo, and one already fixed', () => {
    expect(planFor(row('a', 300, 200), { orientation: 1, width: 300, height: 200 })).toBeNull();
    expect(planFor(row('a', 200, 300), { orientation: 6, width: 300, height: 200 })).toBeNull();
  });
});

function fakes(files: Record<string, Buffer>, rows: PhotoRow[]) {
  const writes: string[] = [];
  const sizes: Record<string, [number, number]> = {};
  const deps: Deps = {
    listPhotos: async () => rows,
    readHead: async (k) => files[k].subarray(0, 256 * 1024),
    readAll: async (k) => files[k],
    upload: async (buffer, key) => {
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
    const result = await run(deps, false);
    expect(result.plans.map((p) => p.id)).toEqual(['a']);
    expect(writes).toEqual([]);
    expect(sizes).toEqual({});
  });

  it('regenerates only derived files on apply, never the original, and is idempotent', async () => {
    const original = await jpeg(8);
    const files: Record<string, Buffer> = { 'o/a': original };
    const rows = [row('a', 300, 200)];
    const { deps, writes, sizes } = fakes(files, rows);
    await run(deps, true);
    expect(writes.sort()).toEqual(['t/a', 'w/a']);
    expect(files['o/a'].equals(original)).toBe(true);
    expect(sizes.a).toEqual([200, 300]);
    expect(await sharp(files['w/a']).metadata()).toMatchObject({ width: 200, height: 300 });

    rows[0] = { ...rows[0], width: 200, height: 300 };
    expect((await run(deps, true)).plans).toEqual([]);
  });

  it('skips a photo whose original cannot be read and keeps going', async () => {
    const files = { 'o/a': Buffer.from('not an image'), 'o/b': await jpeg(6) };
    const { deps } = fakes(files, [row('a', 1, 1), row('b', 300, 200)]);
    const result = await run(deps, false);
    expect(result.unreadable).toBe(1);
    expect(result.plans.map((p) => p.id)).toEqual(['b']);
  });
});
