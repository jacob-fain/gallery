// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTileScheduler, PREVIEW_DELAY_MS } from './tileScheduler';

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

interface TestTile {
  full: HTMLImageElement;
  preview: HTMLImageElement;
}

function grid(count: number): { root: HTMLElement; tiles: TestTile[] } {
  const root = document.createElement('div');
  const tiles: TestTile[] = [];
  for (let i = 0; i < count; i++) {
    const wrapper = document.createElement('div');
    const preview = document.createElement('img');
    preview.dataset.preview = '';
    preview.dataset.src = `https://s3.test/${i}-thumb.webp`;
    const full = document.createElement('img');
    full.dataset.tile = '';
    full.dataset.src = `https://s3.test/${i}-thumb.webp`;
    full.dataset.srcset = `https://s3.test/${i}-thumb.webp 600w, https://s3.test/${i}-web.webp 1920w`;
    tops.set(full, i * TILE_HEIGHT);
    wrapper.append(preview, full);
    root.append(wrapper);
    tiles.push({ full, preview });
  }
  document.body.append(root);
  return { root, tiles };
}

const started = (img: HTMLImageElement) => img.hasAttribute('src') || img.hasAttribute('srcset');
const startedFull = (tiles: TestTile[]) => tiles.flatMap((t, i) => (started(t.full) ? [i] : []));
const startedPreviews = (tiles: TestTile[]) => tiles.flatMap((t, i) => (started(t.preview) ? [i] : []));

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
  it('starts the full images on screen top down and keeps connections for their previews', () => {
    const { root, tiles } = grid(12);
    const stop = createTileScheduler(root);
    expect(startedFull(tiles)).toEqual([0, 1, 2]);
    expect(startedPreviews(tiles)).toEqual([0, 1, 2]);
    expect(tiles[0].full.getAttribute('srcset')).toBe(tiles[0].full.dataset.srcset);
    expect(tiles[0].full.loading).toBe('eager');
    stop();
  });

  it('moves on to the tiles ahead, nearest first, as downloads finish', async () => {
    const { root, tiles } = grid(12);
    const stop = createTileScheduler(root);
    for (const i of [0, 1, 2]) {
      load(tiles[i].preview);
      load(tiles[i].full);
    }
    await Promise.resolve();
    expect(startedFull(tiles)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(startedPreviews(tiles)).toEqual([0, 1, 2, 3, 4, 5]);

    for (const i of [3, 4, 5]) load(tiles[i].preview);
    await Promise.resolve();
    // With no preview waiting, full images get all connections but one.
    expect(startedFull(tiles)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(startedPreviews(tiles)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const i of [6, 7, 8]) load(tiles[i].preview);
    await Promise.resolve();
    expect(startedFull(tiles)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // Nothing past 2.5 screens ahead.
    expect(started(tiles[9].full) || started(tiles[9].preview)).toBe(false);
    stop();
  });

  it('cancels downloads of tiles scrolled past, and keeps finished ones', async () => {
    const { root, tiles } = grid(12);
    const stop = createTileScheduler(root);
    load(tiles[0].full);
    await scrollTo(1200);
    expect(started(tiles[0].full)).toBe(true);
    expect(started(tiles[1].full)).toBe(false);
    expect(started(tiles[1].preview)).toBe(false);
    expect(startedFull(tiles)).toEqual([0, 4, 5, 6]);
    stop();
  });

  it('looks above the viewport once the visitor scrolls back up', async () => {
    const { root, tiles } = grid(20);
    const stop = createTileScheduler(root);
    await scrollTo(3000);
    for (const t of tiles.slice(10, 13)) {
      load(t.full);
      load(t.preview);
    }
    await scrollTo(2990);
    // Ten pixels back is not a turn: the tiles below are still ahead. Tile 9
    // has come on screen and goes first.
    expect(startedFull(tiles)).toEqual([9, 10, 11, 12, 13, 14]);
    await scrollTo(2900);
    expect(startedFull(tiles)).toEqual([7, 8, 9, 10, 11, 12]);
    stop();
  });

  it('gives a started tile its new URLs after a refresh', async () => {
    const { root, tiles } = grid(3);
    const stop = createTileScheduler(root);
    tiles[0].full.dataset.srcset = 'https://s3.test/0-web.webp?sig=new 1920w';
    await new Promise((resolve) => setTimeout(resolve));
    expect(tiles[0].full.getAttribute('srcset')).toBe('https://s3.test/0-web.webp?sig=new 1920w');
    stop();
  });

  it('shows a preview only after its tile has been on screen briefly without its full image', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { root, tiles } = grid(3);
    const stop = createTileScheduler(root);
    load(tiles[0].preview);
    load(tiles[1].preview);
    vi.advanceTimersByTime(PREVIEW_DELAY_MS / 2);
    // Tile 1's full image arrives in time: its preview never shows.
    load(tiles[1].full);
    await Promise.resolve();
    expect('due' in tiles[0].preview.dataset).toBe(false);

    vi.advanceTimersByTime(PREVIEW_DELAY_MS / 2);
    await Promise.resolve();
    expect('due' in tiles[0].preview.dataset).toBe(true);
    expect('due' in tiles[1].preview.dataset).toBe(false);
    stop();
  });

  it('lets the full image paint as it arrives when the preview is not there in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { root, tiles } = grid(12);
    const stop = createTileScheduler(root);
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await Promise.resolve();
    expect('skip' in tiles[0].preview.dataset).toBe(true);
    expect('due' in tiles[0].preview.dataset).toBe(false);

    // A preview arriving later does not replace what the full image painted.
    load(tiles[0].preview);
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await Promise.resolve();
    expect('due' in tiles[0].preview.dataset).toBe(false);

    // Scrolled past, the full image is cancelled, and the tile decides again
    // when it is back.
    await scrollTo(1200);
    expect('skip' in tiles[0].preview.dataset).toBe(false);
    stop();
  });
});
