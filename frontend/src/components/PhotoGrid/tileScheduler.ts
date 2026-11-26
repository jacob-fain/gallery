import { useLayoutEffect, type RefObject } from 'react';
import { setSources } from './tileImage';

/**
 * Decides when each grid tile downloads its image.
 *
 * S3 serves images over HTTP/1.1, so the browser opens about 6 connections
 * to it, and a download that has started holds its connection until it ends.
 * Left to lazy loading, every tile within a screen or so of the viewport
 * starts its image (about 400 KB on a high-DPR screen) at once, and the
 * tiles that scroll in next wait behind downloads for tiles further away.
 *
 * So tile images render without a source (data-src and data-srcset hold it)
 * and this starts them in order: tiles on screen first, top down, then tiles
 * ahead in the scroll direction, nearest first, up to AHEAD_SCREENS screens.
 * At most MAX_LOADS images load at once. Anything that is no longer on
 * screen or ahead (scrolled past, or the visitor turned around) is
 * cancelled.
 */
const AHEAD_SCREENS = 2.5;
const MAX_LOADS = 6;
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

// A failed image (tileImage.ts) is still wanted, so it keeps its place.
const isLoaded = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0 && !('failed' in img.dataset);

const sourceKey = (img: HTMLImageElement) => `${img.dataset.src ?? ''} ${img.dataset.srcset ?? ''}`;

interface Tile {
  img: HTMLImageElement;
  visible: boolean;
  // Pixels from the viewport's leading edge; on screen, from its top.
  distance: number;
}

export function createTileScheduler(grid: HTMLElement) {
  // Every image started, with the sources it was given, to notice a
  // refresh and to cancel it once it is no longer wanted.
  const started = new Map<HTMLImageElement, string>();
  let direction = 1;
  let anchor = window.scrollY;
  let pending = false;
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
      list.push({ img, visible, distance });
    }
    return list;
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

    const wanted = new Set(queue.map((t) => t.img));
    for (const [img, source] of started) {
      if (!img.isConnected || !wanted.has(img)) cancel(img);
      // New URLs after a refresh replace the expired ones being loaded.
      else if (source !== sourceKey(img)) start(img);
    }

    let loads = [...started.keys()].filter(loading).length;
    for (const { img } of queue) {
      if (loads >= MAX_LOADS) break;
      if (started.has(img)) continue;
      start(img);
      loads++;
    }
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
