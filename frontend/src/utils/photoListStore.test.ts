import { describe, expect, it, vi } from 'vitest';
import { LOAD_ALL_PAGE_SIZE, PAGE_SIZE, PhotoListStore } from './photoListStore';
import { addUploaded, removePhotos } from './photoList';

type P = { id: string };
const server = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `p${i}` }));

// A loader over an in-memory list, recording each request.
const loaderFor = (rows: P[]) => {
  const calls: [number, number][] = [];
  const load = vi.fn(async (offset: number, limit: number) => {
    calls.push([offset, limit]);
    return { photos: rows.slice(offset, offset + limit), total: rows.length };
  });
  return { load, calls };
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('PhotoListStore', () => {
  it('loads the first page, then the next one at the loaded count', async () => {
    const { load, calls } = loaderFor(server(250));
    const store = new PhotoListStore<P>(load);
    expect(store.getState().status).toBe('loading');

    await store.reload();
    expect(store.getState().status).toBe('ready');
    expect(store.latest().items).toHaveLength(PAGE_SIZE);
    expect(store.latest().total).toBe(250);

    await store.loadMore();
    expect(calls).toEqual([
      [0, PAGE_SIZE],
      [PAGE_SIZE, PAGE_SIZE],
    ]);
    expect(store.latest().items).toHaveLength(200);
  });

  it('shares a page already on its way instead of fetching it twice', async () => {
    const { load } = loaderFor(server(300));
    const store = new PhotoListStore<P>(load);
    await store.reload();
    await Promise.all([store.loadMore(), store.loadMore()]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('loads every page for Select All, in the largest pages', async () => {
    const { load, calls } = loaderFor(server(520));
    const store = new PhotoListStore<P>(load);
    await store.reload();
    const all = await store.loadAll();
    expect(all?.map((p) => p.id)).toEqual(server(520).map((p) => p.id));
    expect(calls.slice(1)).toEqual([
      [100, LOAD_ALL_PAGE_SIZE],
      [300, LOAD_ALL_PAGE_SIZE],
      [500, LOAD_ALL_PAGE_SIZE],
    ]);
  });

  it('fetches after the photos removed meanwhile, at the new count', async () => {
    const rows = server(150);
    const { load, calls } = loaderFor(rows);
    const store = new PhotoListStore<P>(load);
    await store.reload();
    // Deleted on the server and in the list.
    rows.splice(0, 2);
    store.update((l) => removePhotos(l, ['p0', 'p1']));
    await store.loadMore();
    expect(calls[1]).toEqual([98, PAGE_SIZE]);
    expect(store.latest().items).toHaveLength(148);
    expect(new Set(store.latest().items.map((p) => p.id)).size).toBe(148);
  });

  it('keeps an upload added while a page is loading', async () => {
    const page = deferred<{ photos: P[]; total: number }>();
    const load = vi
      .fn()
      .mockResolvedValueOnce({ photos: [{ id: 'a' }], total: 2 })
      .mockReturnValueOnce(page.promise);
    const store = new PhotoListStore<P>(load);
    await store.reload();
    const more = store.loadMore();
    store.update((l) => addUploaded(l, { id: 'new' }, 'start'));
    page.resolve({ photos: [{ id: 'a' }, { id: 'b' }], total: 3 });
    await more;
    expect(store.latest().items.map((p) => p.id)).toEqual(['new', 'a', 'b']);
  });

  it('drops a page that arrives after a reload', async () => {
    const late = deferred<{ photos: P[]; total: number }>();
    const load = vi
      .fn()
      .mockResolvedValueOnce({ photos: [{ id: 'a' }], total: 5 })
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce({ photos: [{ id: 'x' }], total: 1 });
    const store = new PhotoListStore<P>(load);
    await store.reload();
    const all = store.loadAll();
    await store.reload();
    late.resolve({ photos: [{ id: 'b' }], total: 5 });
    expect(await all).toBeNull();
    expect(store.latest().items.map((p) => p.id)).toEqual(['x']);
  });

  it('reports a failed page and lets the next request retry it', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ photos: [{ id: 'a' }], total: 2 })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ photos: [{ id: 'b' }], total: 2 });
    const store = new PhotoListStore<P>(load);
    await store.reload();
    expect(await store.loadMore()).toBe(false);
    expect(store.getState()).toMatchObject({ moreFailed: true, loadingMore: false });
    expect(await store.loadAll()).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(store.getState().moreFailed).toBe(false);
  });

  it('reports a failed first page as an error', async () => {
    const store = new PhotoListStore<P>(vi.fn().mockRejectedValue(new Error('Gallery not found')));
    await store.reload();
    expect(store.getState()).toMatchObject({ status: 'error', error: 'Gallery not found' });
  });

  it('notifies subscribers of each change', async () => {
    const { load } = loaderFor(server(3));
    const store = new PhotoListStore<P>(load);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    await store.reload();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    store.update((l) => l);
    expect(listener).not.toHaveBeenCalled();
  });
});
