import { describe, expect, it, vi } from 'vitest';
import { run, type Deps, type ObjectHead } from './cacheControlBackfill';
import { OBJECT_CACHE_CONTROL } from '../services/s3Service';

function deps(objects: Record<string, ObjectHead | Error>) {
  const lines: string[] = [];
  const copy = vi.fn<Deps['copyWithCacheControl']>(async () => {});
  const d: Deps = {
    async *listKeys(prefix) {
      for (const key of Object.keys(objects)) if (key.startsWith(prefix)) yield key;
    },
    head: async (key) => {
      const head = objects[key];
      if (head instanceof Error) throw head;
      return head;
    },
    copyWithCacheControl: copy,
    log: (line) => lines.push(line),
  };
  return { d, copy, lines };
}

const webp = (cacheControl?: string): ObjectHead => ({
  contentType: 'image/webp',
  size: 1000,
  metadata: { source: 'upload' },
  ...(cacheControl && { cacheControl }),
});

describe('cacheControlBackfill', () => {
  it('writes nothing in a dry run', async () => {
    const { d, copy, lines } = deps({ 'galleries/g/p/web.webp': webp() });
    expect(await run(d, false)).toEqual({ checked: 1, changed: 1, failed: 0 });
    expect(copy).not.toHaveBeenCalled();
    expect(lines.at(-1)).toContain('Dry run');
  });

  it('copies only objects without the header, keeping their other headers', async () => {
    const { d, copy } = deps({
      'galleries/g/p/web.webp': webp(),
      'galleries/g/p/thumb.webp': webp(OBJECT_CACHE_CONTROL),
      'galleries/g/p/original.jpg': { contentType: 'image/jpeg', size: 5000, cacheControl: 'max-age=60' },
    });
    expect(await run(d, true)).toEqual({ checked: 3, changed: 2, failed: 0 });
    expect(copy.mock.calls.map(([key]) => key)).toEqual(['galleries/g/p/web.webp', 'galleries/g/p/original.jpg']);
    expect(copy).toHaveBeenCalledWith('galleries/g/p/web.webp', webp(), OBJECT_CACHE_CONTROL);
  });

  it('carries on past an object it cannot read or copy, and counts it', async () => {
    const { d, copy } = deps({
      'galleries/g/a/web.webp': new Error('AccessDenied'),
      'galleries/g/b/web.webp': webp(),
      'galleries/g/c/original.tif': { size: 6 * 1024 ** 3 },
    });
    expect(await run(d, true)).toEqual({ checked: 3, changed: 1, failed: 2 });
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('looks only under the photo prefix', async () => {
    const { d } = deps({ 'other/file.txt': webp(), 'galleries/g/p/web.webp': webp() });
    expect((await run(d, false)).checked).toBe(1);
  });
});
