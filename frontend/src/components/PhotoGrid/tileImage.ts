import type { SyntheticEvent } from 'react';
import { reportImageFailure, type ImageFailure } from '../../utils/clientErrors';

/**
 * Load handling for grid tile images. When each tile's image starts loading
 * is decided in tileScheduler.ts. A tile shows its placeholder colour until
 * the image's bytes arrive, and the image paints as they do.
 *
 * - A load counts only once the image decodes at its expected size. A
 *   connection that drops part way can still fire load: Firefox then holds a
 *   half-drawn, undecodable image ("Image corrupt or truncated"). Such a load
 *   is a failure like any other (truncated).
 * - A failed load is hidden (data-failed), so the tile shows its placeholder
 *   and not a broken-image icon or half a photo, and is retried after each of
 *   RETRY_DELAYS_MS, then every RETRY_INTERVAL_MS while the tile is on
 *   screen, so a tile never stays empty for good. Each retry is a new request
 *   even for the same URL (the grid's refresh can hand back the same signed
 *   URL, and setting an unchanged src starts no load). A new src is a new
 *   load and starts the delays over.
 * - A download that has not finished LOAD_TIMEOUT_MS after it started is
 *   taken as stalled and retried (timeout). It holds one of the few
 *   connections to the image host while it hangs.
 * - The REPORT_AFTER_FAILURES-th failure of a tile's image is reported to the
 *   server log (reportImageFailure limits how many reach it).
 * - A tile removed before its image finished cancels the download. A shuffle
 *   remounts most tiles (the album keys tiles within each column), and the
 *   browser otherwise finishes every abandoned download first while the tiles
 *   on screen wait behind them.
 */
export const RETRY_DELAYS_MS = [1000, 3000, 8000];
export const RETRY_INTERVAL_MS = 30_000;
// About 6 kB/s for a 400 KB web image: far slower than any connection that
// is still moving, and the browser reports no progress to tell them apart.
export const LOAD_TIMEOUT_MS = 60_000;
export const REPORT_AFTER_FAILURES = 3;
// The thumbnail is at most this wide (THUMBNAIL_MAX_WIDTH in imageSizes.ts),
// and a web image is always wider than the thumbnail it is listed beside.
const THUMBNAIL_MAX_WIDTH = 600;

interface TileState {
  // The src and srcset whose loads have failed, and how many times.
  failedSource?: string;
  failures: number;
  // Every failure of this tile's image, whatever its source.
  totalFailures: number;
  // Counts the loads started, so a retry that is due after another load has
  // begun (the scheduler starting the tile again) leaves that load alone.
  loads: number;
  timer?: ReturnType<typeof setTimeout>;
  watchdog?: ReturnType<typeof setTimeout>;
}

const states = new WeakMap<HTMLImageElement, TileState>();

function stateOf(img: HTMLImageElement): TileState {
  let state = states.get(img);
  if (!state) {
    state = { failures: 0, totalFailures: 0, loads: 0 };
    states.set(img, state);
  }
  return state;
}

function sourceOf(img: HTMLImageElement): string {
  return `${img.getAttribute('src') ?? ''} ${img.getAttribute('srcset') ?? ''}`;
}

const hasSource = (img: HTMLImageElement) => img.hasAttribute('src') || img.hasAttribute('srcset');

// Removing the sources stops the load; setting them again starts a new one,
// which is how the browser retries an image that failed.
export function setSources(img: HTMLImageElement, src: string | null, srcset: string | null) {
  const state = stateOf(img);
  clearTimeout(state.watchdog);
  img.removeAttribute('srcset');
  img.removeAttribute('src');
  if (srcset !== null) img.setAttribute('srcset', srcset);
  if (src !== null) img.setAttribute('src', src);
  if (!hasSource(img)) return;
  state.loads += 1;
  const source = sourceOf(img);
  state.watchdog = setTimeout(() => {
    if (img.isConnected && !img.complete && sourceOf(img) === source) fail(img, 'timeout');
  }, LOAD_TIMEOUT_MS);
}

function cancelDownload(img: HTMLImageElement) {
  const state = states.get(img);
  clearTimeout(state?.timer);
  // React releases the ref before it removes the element, and StrictMode
  // releases and reattaches refs of elements it keeps, so only an element
  // that is gone once the commit has finished is cancelled.
  queueMicrotask(() => {
    if (img.isConnected) return;
    clearTimeout(state?.watchdog);
    if (!img.complete) setSources(img, null, null);
  });
}

function attach(img: HTMLImageElement | null) {
  if (!img) return;
  return () => cancelDownload(img);
}

// The candidate's width as the srcset lists it, for the file the browser
// picked; undefined when the srcset does not name it.
function listedWidth(img: HTMLImageElement): number | undefined {
  const chosen = img.currentSrc;
  if (!chosen) return undefined;
  for (const candidate of (img.getAttribute('srcset') ?? '').split(',')) {
    const [url, descriptor] = candidate.trim().split(/\s+/);
    if (url === chosen && descriptor?.endsWith('w')) return Number.parseInt(descriptor, 10) || undefined;
  }
  return undefined;
}

/**
 * Whether a loaded image decoded to roughly the file it was meant to be. For
 * a file picked from a srcset by width, naturalWidth is scaled by the
 * candidate's listed width: it comes out at the source size from `sizes`
 * (about the tile's width) when the file is as wide as listed, and smaller
 * in proportion when it is not. Only a far smaller image fails.
 */
async function decodedWhole(img: HTMLImageElement): Promise<boolean> {
  if (typeof img.decode === 'function') {
    try {
      await img.decode();
    } catch {
      return false;
    }
  }
  if (img.naturalWidth === 0 || img.naturalHeight === 0) return false;
  if (listedWidth(img) === undefined) return true;
  const shown = img.getBoundingClientRect().width;
  return !shown || img.naturalWidth * 2 >= shown;
}

function onLoad(event: SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  const source = sourceOf(img);
  const state = stateOf(img);
  clearTimeout(state.watchdog);
  void decodedWhole(img).then((whole) => {
    // A new source (a refresh, a retry, a cancel) has its own load.
    if (!img.isConnected || sourceOf(img) !== source) return;
    if (!whole) {
      fail(img, 'truncated');
      return;
    }
    delete img.dataset.failed;
    clearTimeout(state.timer);
    state.failures = 0;
    state.failedSource = undefined;
  });
}

function onScreen(img: HTMLImageElement): boolean {
  const rect = img.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

function report(img: HTMLImageElement, failure: ImageFailure, attempts: number) {
  const photoId = img.dataset.photo;
  if (!photoId) return;
  const listed = listedWidth(img);
  const kind = listed !== undefined ? (listed > THUMBNAIL_MAX_WIDTH ? 'web' : 'thumb') : 'thumb';
  reportImageFailure({ photoId, kind, failure, attempts });
}

function fail(img: HTMLImageElement, failure: ImageFailure) {
  img.dataset.failed = '';
  const state = stateOf(img);
  clearTimeout(state.watchdog);
  const source = sourceOf(img);
  if (state.failedSource !== source) {
    state.failedSource = source;
    state.failures = 0;
  }
  const delay = RETRY_DELAYS_MS[state.failures] ?? RETRY_INTERVAL_MS;
  const patient = state.failures >= RETRY_DELAYS_MS.length;
  state.failures += 1;
  state.totalFailures += 1;
  if (state.totalFailures >= REPORT_AFTER_FAILURES) report(img, failure, state.totalFailures);
  clearTimeout(state.timer);
  const failedLoad = state.loads;
  const retry = () => {
    // A new src from a refresh, or a load the scheduler started, is already
    // under way.
    if (!img.isConnected || sourceOf(img) !== source || state.loads !== failedLoad) return;
    // Past the quick retries, a tile off screen waits until it is back.
    if (patient && !onScreen(img)) {
      state.timer = setTimeout(retry, RETRY_INTERVAL_MS);
      return;
    }
    // Shown again, so the new attempt paints as it arrives.
    delete img.dataset.failed;
    setSources(img, img.getAttribute('src'), img.getAttribute('srcset'));
  };
  state.timer = setTimeout(retry, delay);
}

function onError(event: SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  // A tile whose download was cancelled has no sources and did not fail.
  if (!hasSource(img)) return;
  fail(img, 'error');
}

// Stable references, so React attaches the ref once per image.
export const TILE_IMAGE_PROPS = { ref: attach, onLoad, onError };
