import { describe, expect, it } from 'vitest';
import type { Photo } from '../types';
import { createRefreshGuard, withFreshSignedUrls, withFreshUrls } from './expiredImages';

describe('createRefreshGuard', () => {
  it('allows the first refresh and then one per interval', () => {
    let t = 1000;
    const mayRefresh = createRefreshGuard(60_000, () => t);
    expect(mayRefresh()).toBe(true);
    // Every image of an expired page fails at about the same time.
    expect(mayRefresh()).toBe(false);
    t += 59_999;
    expect(mayRefresh()).toBe(false);
    t += 1;
    expect(mayRefresh()).toBe(true);
    expect(mayRefresh()).toBe(false);
  });
});

const photo = (id: string, url: string) => ({ id, webUrl: url, thumbnailUrl: url }) as Photo;

describe('withFreshUrls', () => {
  it('takes the fresh URLs and keeps the current order', () => {
    const current = [photo('b', 'old-b'), photo('a', 'old-a')];
    const fresh = [photo('a', 'new-a'), photo('b', 'new-b')];
    expect(withFreshUrls(current, fresh).map((p) => [p.id, p.webUrl])).toEqual([
      ['b', 'new-b'],
      ['a', 'new-a'],
    ]);
  });

  it('drops photos that are gone and does not add new ones', () => {
    const current = [photo('a', 'old-a'), photo('gone', 'old')];
    const fresh = [photo('a', 'new-a'), photo('new', 'new')];
    expect(withFreshUrls(current, fresh).map((p) => p.id)).toEqual(['a']);
  });
});

describe('withFreshSignedUrls', () => {
  it('swaps only the signed URLs and keeps every other field as it is now', () => {
    const current = [{ ...photo('a', 'old-a'), url: 'old-orig', is_hidden: true }];
    const fresh = [{ ...photo('a', 'new-a'), url: 'new-orig', is_hidden: false }];
    expect(withFreshSignedUrls(current, fresh)).toEqual([
      { id: 'a', webUrl: 'new-a', thumbnailUrl: 'new-a', url: 'new-orig', is_hidden: true },
    ]);
  });

  it('keeps photos missing from the fresh list, adds none, and keeps the order', () => {
    const current = [photo('b', 'old-b'), photo('gone', 'old'), photo('a', 'old-a')];
    const fresh = [photo('a', 'new-a'), photo('b', 'new-b'), photo('new', 'new')];
    expect(withFreshSignedUrls(current, fresh).map((p) => [p.id, p.thumbnailUrl])).toEqual([
      ['b', 'new-b'],
      ['gone', 'old'],
      ['a', 'new-a'],
    ]);
  });

  it('keeps the same object for a photo whose URLs did not change', () => {
    const current = [photo('a', 'same')];
    expect(withFreshSignedUrls(current, [photo('a', 'same')])[0]).toBe(current[0]);
  });
});
