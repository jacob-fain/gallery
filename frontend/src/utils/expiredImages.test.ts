import { describe, expect, it } from 'vitest';
import type { Photo } from '../types';
import { createRefreshGuard, withFreshUrls } from './expiredImages';

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
