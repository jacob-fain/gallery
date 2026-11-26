import type { SyntheticEvent } from 'react';

/**
 * Load handling for grid tile images. When each tile's full image starts
 * loading, and when its preview may show, is decided in tileScheduler.ts.
 *
 * - A tile's full image is marked data-loaded once it has loaded. Behind it
 *   sits a preview (the photo's thumbnail), and while the preview shows the
 *   full image stays hidden until it has loaded completely, so it replaces
 *   the preview in one quick fade instead of painting over it top down.
 * - A failed load is hidden (data-failed), so the tile shows its preview or
 *   placeholder and not a broken-image icon, and is retried after each of
 *   RETRY_DELAYS_MS, then every RETRY_INTERVAL_MS while the tile is on
 *   screen, so a tile never stays on its preview for good. Each retry is a
 *   new request even for the same URL (the grid's refresh can hand back the
 *   same signed URL, and setting an unchanged src starts no load). A new
 *   src is a new load and starts the delays over.
 * - A tile removed before its image finished cancels the download. A shuffle
 *   remounts most tiles (the album keys tiles within each column), and the
 *   browser otherwise finishes every abandoned download first while the tiles
 *   on screen wait behind them.
 */
export const RETRY_DELAYS_MS = [1000, 3000, 8000];
export const RETRY_INTERVAL_MS = 30_000;

interface TileState {
  // The src and srcset whose loads have failed, and how many times.
  failedSource?: string;
  failures: number;
  timer?: ReturnType<typeof setTimeout>;
}

const states = new WeakMap<HTMLImageElement, TileState>();

function stateOf(img: HTMLImageElement): TileState {
  let state = states.get(img);
  if (!state) {
    state = { failures: 0 };
    states.set(img, state);
  }
  return state;
}

function sourceOf(img: HTMLImageElement): string {
  return `${img.getAttribute('src') ?? ''} ${img.getAttribute('srcset') ?? ''}`;
}

const isLoaded = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0;

// Removing the sources stops the load; setting them again starts a new one,
// which is how the browser retries an image that failed.
export function setSources(img: HTMLImageElement, src: string | null, srcset: string | null) {
  img.removeAttribute('srcset');
  img.removeAttribute('src');
  if (srcset !== null) img.setAttribute('srcset', srcset);
  if (src !== null) img.setAttribute('src', src);
}

function cancelDownload(img: HTMLImageElement) {
  clearTimeout(states.get(img)?.timer);
  // React releases the ref before it removes the element, and StrictMode
  // releases and reattaches refs of elements it keeps, so only an element
  // that is gone once the commit has finished is cancelled.
  queueMicrotask(() => {
    if (!img.isConnected && !img.complete) setSources(img, null, null);
  });
}

function attach(img: HTMLImageElement | null) {
  if (!img) return;
  if (isLoaded(img)) img.dataset.loaded = '';
  return () => cancelDownload(img);
}

function onLoad(event: SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  delete img.dataset.failed;
  img.dataset.loaded = '';
  const state = states.get(img);
  if (state) {
    clearTimeout(state.timer);
    state.failures = 0;
    state.failedSource = undefined;
  }
}

function onScreen(img: HTMLImageElement): boolean {
  const rect = img.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

function onError(event: SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  // A tile whose download was cancelled has no sources and did not fail.
  if (!img.hasAttribute('src') && !img.hasAttribute('srcset')) return;
  img.dataset.failed = '';
  const state = stateOf(img);
  const source = sourceOf(img);
  if (state.failedSource !== source) {
    state.failedSource = source;
    state.failures = 0;
  }
  const delay = RETRY_DELAYS_MS[state.failures] ?? RETRY_INTERVAL_MS;
  const patient = state.failures >= RETRY_DELAYS_MS.length;
  state.failures += 1;
  clearTimeout(state.timer);
  const retry = () => {
    // A new src from a refresh is already loading.
    if (!img.isConnected || sourceOf(img) !== source) return;
    // Past the quick retries, a tile off screen waits until it is back.
    if (patient && !onScreen(img)) {
      state.timer = setTimeout(retry, RETRY_INTERVAL_MS);
      return;
    }
    setSources(img, img.getAttribute('src'), img.getAttribute('srcset'));
  };
  state.timer = setTimeout(retry, delay);
}

// Stable references, so React attaches the ref once per image.
export const TILE_IMAGE_PROPS = { ref: attach, onLoad, onError };

function onPreviewLoad(event: SyntheticEvent<HTMLImageElement>) {
  delete event.currentTarget.dataset.failed;
  event.currentTarget.dataset.shown = '';
}

// A failed preview stays hidden; the full image then shows as it arrives.
function onPreviewError(event: SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  if (img.hasAttribute('src')) img.dataset.failed = '';
}

export const PREVIEW_IMAGE_PROPS = {
  alt: '',
  'aria-hidden': true,
  'data-preview': '',
  decoding: 'async',
  onLoad: onPreviewLoad,
  onError: onPreviewError,
} as const;
