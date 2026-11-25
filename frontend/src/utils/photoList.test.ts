import { describe, expect, it } from 'vitest';
import { addUploaded, appendPage, emptyList, hasMore, insertPhoto, mapPhotos, removePhotos, type PhotoList } from './photoList';

type P = { id: string; hidden?: boolean };
const p = (id: string): P => ({ id });
const ids = (list: PhotoList<P>) => list.items.map((x) => x.id);
const list = (items: string[], total: number): PhotoList<P> => ({ items: items.map(p), total });

describe('appendPage', () => {
  it('adds a page after the loaded photos and takes the server total', () => {
    const next = appendPage(list(['a', 'b'], 5), { photos: [p('c'), p('d')], total: 6 });
    expect(ids(next)).toEqual(['a', 'b', 'c', 'd']);
    expect(next.total).toBe(6);
    expect(hasMore(next)).toBe(true);
  });

  it('starts an empty list from the first page', () => {
    const first = appendPage(emptyList<P>(), { photos: [p('a')], total: 1 });
    expect(ids(first)).toEqual(['a']);
    expect(hasMore(first)).toBe(false);
  });

  it('skips photos already loaded', () => {
    const next = appendPage(list(['a', 'b'], 4), { photos: [p('b'), p('c')], total: 4 });
    expect(ids(next)).toEqual(['a', 'b', 'c']);
  });

  it('ends the list when a page adds nothing, so loading stops', () => {
    expect(appendPage(list(['a', 'b'], 4), { photos: [], total: 4 })).toEqual(list(['a', 'b'], 2));
    expect(appendPage(list(['a', 'b'], 4), { photos: [p('a')], total: 4 })).toEqual(list(['a', 'b'], 2));
  });

  it('never reports fewer photos than are loaded', () => {
    expect(appendPage(list(['a'], 3), { photos: [p('b'), p('c')], total: 2 }).total).toBe(3);
  });
});

describe('addUploaded', () => {
  it('puts an unassigned upload first', () => {
    const next = addUploaded(list(['a', 'b'], 10), p('new'), 'start');
    expect(ids(next)).toEqual(['new', 'a', 'b']);
    expect(next.total).toBe(11);
  });

  it('puts a gallery upload last once the whole gallery is loaded', () => {
    const next = addUploaded(list(['a', 'b'], 2), p('new'), 'end');
    expect(ids(next)).toEqual(['a', 'b', 'new']);
    expect(next.total).toBe(3);
  });

  it('holds back a gallery upload while later pages are unloaded, counting it', () => {
    const next = addUploaded(list(['a', 'b'], 5), p('new'), 'end');
    expect(ids(next)).toEqual(['a', 'b']);
    expect(next.total).toBe(6);
    // The last page brings it.
    const done = appendPage(next, { photos: [p('c'), p('d'), p('e'), p('new')], total: 6 });
    expect(ids(done)).toEqual(['a', 'b', 'c', 'd', 'e', 'new']);
    expect(hasMore(done)).toBe(false);
  });

  it('ignores an upload a page already brought', () => {
    const current = list(['new', 'a'], 2);
    expect(addUploaded(current, p('new'), 'start')).toBe(current);
  });

  it('keeps the other photos, so their cards do not re-render', () => {
    const current = list(['a', 'b'], 2);
    const next = addUploaded(current, p('c'), 'end');
    expect(next.items[0]).toBe(current.items[0]);
    expect(next.items[1]).toBe(current.items[1]);
  });
});

describe('removePhotos', () => {
  it('drops the photos and lowers the total', () => {
    const next = removePhotos(list(['a', 'b', 'c'], 10), ['b', 'zz']);
    expect(ids(next)).toEqual(['a', 'c']);
    expect(next.total).toBe(9);
  });

  it('returns the same list when nothing was loaded', () => {
    const current = list(['a'], 3);
    expect(removePhotos(current, ['x'])).toBe(current);
  });
});

describe('mapPhotos', () => {
  it('changes only the photos the function replaces', () => {
    const current = list(['a', 'b'], 2);
    const next = mapPhotos(current, (x) => (x.id === 'b' ? { ...x, hidden: true } : x));
    expect(next.items[0]).toBe(current.items[0]);
    expect(next.items[1]).toEqual({ id: 'b', hidden: true });
  });
});

describe('insertPhoto', () => {
  it('puts a photo back at its index and counts it', () => {
    const next = insertPhoto(list(['a', 'c'], 10), p('b'), 1);
    expect(ids(next)).toEqual(['a', 'b', 'c']);
    expect(next.total).toBe(11);
  });

  it('clamps the index to the loaded photos and never adds a photo twice', () => {
    expect(ids(insertPhoto(list(['a'], 1), p('b'), 5))).toEqual(['a', 'b']);
    const same = list(['a', 'b'], 2);
    expect(insertPhoto(same, p('b'), 0)).toBe(same);
  });
});
