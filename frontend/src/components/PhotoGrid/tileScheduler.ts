import { useLayoutEffect, type RefObject } from 'react';
import { setSources } from './tileImage';

/**
 * Decides when each grid tile downloads its full image and its preview.
 *
 * S3 serves images over HTTP/1.1, so the browser opens about 6 connections
 * to it, and a download that has started holds its connection until it ends.
 * Left to lazy loading, every tile within a screen or so of the viewport
 * starts its full image (about 400 KB on a high-DPR screen) at once, and the
 * tiles that scroll in next, and even their small previews, wait behind
 * downloads for tiles further away.
 *
 * So tile images render without a source (data-src and data-srcset hold it)
 * and this starts them in order: tiles on screen first, top down, then tiles
 * ahead in the scroll direction, nearest first, up to AHEAD_SCREENS screens.
 * At most MAX_LOADS images load at once, and connections are kept free for
 * previews, so a preview does not wait behind full images.
 * Anything that is no longer on screen or ahead (scrolled past, or the
 * visitor turned around) is cancelled.
 *
 * A preview (a tenth of the bytes) keeps a tile that scrolls in before its
 * full image from showing an empty placeholder. Once a tile has been on
 * screen for PREVIEW_DELAY_MS without its full image, the preview shows if
 * it has loaded (data-due); if it has not, the full image paints as its
 * bytes arrive instead (data-skip), rather than the tile waiting on either.
 * So a full image that is cached or arrives quickly replaces the placeholder
 * directly, and a preview is not downloaded at all for a tile whose full
 * image loaded first.
 */
const AHEAD_SCREENS = 2.5;
const MAX_LOADS = 6;
// Full images may take every connection but one, and only three while a
// preview is waiting: previews are small, so their time is mostly latency,
// and with fewer connections they fall behind a fast scroll and tiles show
// empty placeholders. That holds on the first screen too: once previews
// fall behind at the start of a scroll, they do not catch up.
const MAX_FULL = 5;
const MAX_FULL_WITH_PREVIEWS = 3;
export const PREVIEW_DELAY_MS = 100;
// Scrolling back this far turns what counts as ahead around.
const TURN_DISTANCE = 50;
const TILE_SELECTOR = 'img[data-tile]';
const REPLAN_EVENT = 'tilereplan';

/**
 * Asks the scheduler of the grid holding `from` to plan again. For a layout
 * that moves its tiles without adding any or changing their sources (the
 * collage after a resize or a new arrangement), which nothing else notices.
 */
export function replanTiles(from: Element): void {
  from.dispatchEvent(new Event(REPLAN_EVENT, { bubbles: true }));
}

const isLoaded = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0;

function previewOf(img: HTMLImageElement): HTMLImageElement | null {
  const previous = img.previousElementSibling;
  return previous instanceof HTMLImageElement && 'preview' in previous.dataset ? previous : null;
}

const sourceKey = (img: HTMLImageElement) => `${img.dataset.src ?? ''} ${img.dataset.srcset ?? ''}`;

interface Tile {
  img: HTMLImageElement;
  preview: HTMLImageElement | null;
  visible: boolean;
  // Pixels from the viewport's leading edge; on screen, from its top.
  distance: number;
}

export function createTileScheduler(grid: HTMLElement) {
  // Every image started, with the sources it was given, to notice a
  // refresh and to cancel it once it is no longer wanted.
  const started = new Map<HTMLImageElement, string>();
  const firstSeen = new WeakMap<HTMLImageElement, number>();
  let direction = 1;
  let anchor = window.scrollY;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function start(img: HTMLImageElement) {
    started.set(img, sourceKey(img));
    // The scheduler decides when; lazy loading would hold back an image it
    // has counted as loading.
    img.loading = 'eager';
    setSources(img, img.dataset.src ?? null, img.dataset.srcset ?? null);
  }

  function cancel(img: HTMLImageElement) {
    started.delete(img);
    if (!img.complete) setSources(img, null, null);
    // What the full image had painted is gone, so a preview may show when
    // the tile is back.
    const preview = previewOf(img);
    if (preview) delete preview.dataset.skip;
  }

  const loading = (img: HTMLImageElement) => started.has(img) && !img.complete;

  function tiles(): Tile[] {
    const height = window.innerHeight;
    const list: Tile[] = [];
    for (const img of grid.querySelectorAll<HTMLImageElement>(TILE_SELECTOR)) {
      const rect = img.getBoundingClientRect();
      // A tile with no layout (not displayed) is simply loaded.
      const visible = (rect.width === 0 && rect.height === 0) || (rect.bottom > 0 && rect.top < height);
      const distance = visible ? rect.top : direction > 0 ? rect.top - height : -rect.bottom;
      list.push({ img, preview: previewOf(img), visible, distance });
    }
    return list;
  }

  // Returns how long until the next preview is due, if one is pending.
  function revealPreviews(onScreen: Tile[]): number {
    const now = performance.now();
    let wait = Infinity;
    for (const { img, preview } of onScreen) {
      if (!preview || 'due' in preview.dataset || 'skip' in preview.dataset || isLoaded(img)) continue;
      const seen = firstSeen.get(img) ?? now;
      firstSeen.set(img, seen);
      const left = seen + PREVIEW_DELAY_MS - now;
      if (left > 0) wait = Math.min(wait, left);
      else if (isLoaded(preview)) preview.dataset.due = '';
      else preview.dataset.skip = '';
    }
    return wait;
  }

  function plan() {
    pending = false;
    if (stopped) return;
    const height = window.innerHeight;
    const all = tiles();
    const onScreen = all.filter((t) => t.visible).sort((a, b) => a.distance - b.distance);
    const ahead = all
      .filter((t) => !t.visible && t.distance >= 0 && t.distance <= AHEAD_SCREENS * height)
      .sort((a, b) => a.distance - b.distance);
    const queue = [...onScreen, ...ahead].filter((t) => !isLoaded(t.img));

    const wanted = new Set<HTMLImageElement>();
    for (const { img, preview } of queue) {
      wanted.add(img);
      if (preview && !isLoaded(preview)) wanted.add(preview);
    }
    for (const [img, source] of started) {
      if (!img.isConnected || !wanted.has(img)) cancel(img);
      // New URLs after a refresh replace the expired ones being loaded.
      else if (source !== sourceKey(img)) start(img);
    }
    for (const { img } of all) if (!onScreen.some((t) => t.img === img)) firstSeen.delete(img);

    let loads = [...started.keys()].filter(loading).length;
    let full = queue.filter((t) => loading(t.img)).length;
    const previewsWaiting = queue.some(({ preview }) => preview && !isLoaded(preview));
    const maxFull = previewsWaiting ? MAX_FULL_WITH_PREVIEWS : MAX_FULL;
    for (const { img } of queue) {
      if (loads >= MAX_LOADS || full >= maxFull) break;
      if (started.has(img)) continue;
      start(img);
      loads++;
      full++;
    }
    for (const { preview } of queue) {
      if (loads >= MAX_LOADS) break;
      if (!preview || started.has(preview) || isLoaded(preview)) continue;
      start(preview);
      loads++;
    }

    const wait = revealPreviews(onScreen);
    clearTimeout(timer);
    if (wait !== Infinity) timer = setTimeout(schedule, wait);
  }

  // After the current task (a commit, a scroll event), before the next
  // paint, so new tiles' downloads start in the frame they appear.
  function schedule() {
    if (pending || stopped) return;
    pending = true;
    queueMicrotask(plan);
  }

  // `anchor` is the furthest point reached in the current direction.
  function onScroll() {
    const y = window.scrollY;
    const moved = y - anchor;
    if (moved * direction > 0) anchor = y;
    else if (Math.abs(moved) >= TURN_DISTANCE) {
      direction = -direction;
      anchor = y;
    }
    schedule();
  }

  // New tiles, and new URLs after a refresh, change what to load.
  const mutations = new MutationObserver(schedule);
  mutations.observe(grid, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-src', 'data-srcset'],
  });
  // A finished download frees its place for the next.
  grid.addEventListener('load', schedule, true);
  grid.addEventListener('error', schedule, true);
  grid.addEventListener(REPLAN_EVENT, schedule);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', schedule);
  plan();

  return () => {
    stopped = true;
    clearTimeout(timer);
    mutations.disconnect();
    grid.removeEventListener('load', schedule, true);
    grid.removeEventListener('error', schedule, true);
    grid.removeEventListener(REPLAN_EVENT, schedule);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', schedule);
    for (const img of started.keys()) if (!img.isConnected) cancel(img);
  };
}

/**
 * Runs the scheduler for the tiles in `gridRef`. Runs before paint, so the
 * first screen's images are requested in the same frame as their tiles.
 */
export function useTileScheduler(gridRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    return createTileScheduler(grid);
  }, [gridRef]);
}
