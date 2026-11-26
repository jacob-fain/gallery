// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTileScheduler, replanTiles } from './tileScheduler';

// jsdom has no layout and loads no images. Tiles are stacked 300px apart in
// one column, a tile's position follows window.scrollY, and a test decides
// which images have loaded.
const TILE_HEIGHT = 300;
const loaded = new Set<HTMLImageElement>();
const tops = new Map<HTMLImageElement, number>();
let scrollY = 0;

const descriptors = {
  complete: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete'),
  naturalWidth: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth'),
};

beforeEach(() => {
  loaded.clear();
  tops.clear();
  scrollY = 0;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get(this: HTMLImageElement) {
      return loaded.has(this) || (!this.hasAttribute('src') && !this.hasAttribute('srcset'));
    },
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get(this: HTMLImageElement) {
      return loaded.has(this) ? 600 : 0;
    },
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = (tops.get(this as HTMLImageElement) ?? 0) - scrollY;
    return { top, bottom: top + TILE_HEIGHT, width: 400, height: TILE_HEIGHT } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(HTMLImageElement.prototype, name, descriptor);
  }
  document.body.innerHTML = '';
});

function grid(count: number): { root: HTMLElement; tiles: HTMLImageElement[] } {
  const root = document.createElement('div');
  const tiles: HTMLImageElement[] = [];
  for (let i = 0; i < count; i++) {
    const wrapper = document.createElement('div');
    const img = document.createElement('img');
    img.dataset.tile = '';
    img.dataset.src = `https://s3.test/${i}-thumb.webp`;
    img.dataset.srcset = `https://s3.test/${i}-thumb.webp 600w, https://s3.test/${i}-web.webp 1920w`;
    tops.set(img, i * TILE_HEIGHT);
    wrapper.append(img);
    root.append(wrapper);
    tiles.push(img);
  }
  document.body.append(root);
  return { root, tiles };
}

const started = (img: HTMLImageElement) => img.hasAttribute('src') || img.hasAttribute('srcset');
const startedTiles = (tiles: HTMLImageElement[]) => tiles.flatMap((t, i) => (started(t) ? [i] : []));

function load(img: HTMLImageElement) {
  loaded.add(img);
  img.dispatchEvent(new Event('load'));
}

async function scrollTo(y: number) {
  scrollY = y;
  window.dispatchEvent(new Event('scroll'));
  await Promise.resolve();
}

// jsdom's innerHeight is 768: tiles 0 to 2 are on screen, and 2.5 screens
// ahead reach tile 8.
describe('tile scheduler', () => {
  it('starts the tiles on screen top down, then the nearest ahead, six at a time', () => {
    const { root, tiles } = grid(12);
    const stop = createTileScheduler(root);
    expect(startedTiles(tiles)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(tiles[0].getAttribute('srcset')).toBe(tiles[0].dataset.srcset);
    expect(tiles[0].loading).toBe('eager');
    // Nothing else is downloaded for a tile: no preview of it.
    expect(root.querySelectorAll('img')).toHaveLength(12);
    stop();
  });

  it('moves on to the tiles ahead, nearest first, as downloads finish', async () => {
    const { root, tiles } = grid(12);
    const stop = createTileScheduler(root);
    for (const i of [0, 1, 2]) load(tiles[i]);
    await Promise.resolve();
    expect(startedTiles(tiles)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const i of [3, 4, 5]) load(tiles[i]);
    await Promise.resolve();
    // Nothing past 2.5 screens ahead.
    expect(startedTiles(tiles)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    stop();
  });

  it('cancels downloads of tiles scrolled past, and keeps finished ones', async () => {
    const { root, tiles } = grid(14);
    const stop = createTileScheduler(root);
    load(tiles[0]);
    await scrollTo(1200);
    expect(started(tiles[0])).toBe(true);
    expect(started(tiles[1])).toBe(false);
    expect(startedTiles(tiles)).toEqual([0, 4, 5, 6, 7, 8, 9]);
    stop();
  });

  it('plans again when asked after tiles move without a scroll', async () => {
    const { root, tiles } = grid(12);
    const stop = createTileScheduler(root);
    // A new layout swaps the first and the last tile.
    tops.set(tiles[0], 11 * TILE_HEIGHT);
    tops.set(tiles[11], 0);
    await Promise.resolve();
    expect(started(tiles[11])).toBe(false);

    replanTiles(tiles[11]);
    await Promise.resolve();
    expect(started(tiles[11])).toBe(true);
    expect(started(tiles[0])).toBe(false);
    stop();
  });

  it('looks above the viewport once the visitor scrolls back up', async () => {
    const { root, tiles } = grid(20);
    const stop = createTileScheduler(root);
    await scrollTo(3000);
    for (const t of tiles.slice(10, 13)) load(t);
    await scrollTo(2990);
    // Ten pixels back is not a turn: the tiles below are still ahead. Tile 9
    // has come on screen and goes first.
    expect(startedTiles(tiles)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    await scrollTo(2900);
    expect(startedTiles(tiles)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    stop();
  });

  it('keeps a tile whose image failed and starts it again when it is back in reach', async () => {
    const { root, tiles } = grid(14);
    const stop = createTileScheduler(root);
    load(tiles[0]);
    tiles[0].dataset.failed = '';
    await scrollTo(1200);
    const setAttribute = vi.spyOn(tiles[0], 'setAttribute');
    await scrollTo(0);
    // On screen again, the failed tile is requested again.
    expect(setAttribute).toHaveBeenCalledWith('srcset', tiles[0].dataset.srcset);
    stop();
  });

  it('gives a started tile its new URLs after a refresh', async () => {
    const { root, tiles } = grid(3);
    const stop = createTileScheduler(root);
    tiles[0].dataset.srcset = 'https://s3.test/0-web.webp?sig=new 1920w';
    await new Promise((resolve) => setTimeout(resolve));
    expect(tiles[0].getAttribute('srcset')).toBe('https://s3.test/0-web.webp?sig=new 1920w');
    stop();
  });
});
