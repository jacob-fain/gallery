import { lazy, type ComponentType } from 'react';
import { reportClientError } from './clientErrors';

const RELOAD_KEY = 'chunk-reload-at';
// The page a reload opens starts within moments of the reload call; a page
// that started this soon after the recorded reload is the one it opened.
const RELOAD_START_MS = 10_000;
// A chunk that still fails this soon after the reloaded page started means a
// reload does not fix it, so the error propagates instead of looping. Counted
// from the page's start, not the reload call, so a slow connection that
// takes a long time to fetch the page again still counts as the same reload.
const RELOADED_PAGE_MS = 5 * 60 * 1000;

// Chrome, Firefox and Safari's messages for a module that failed to fetch,
// Vite's for a chunk's stylesheet, and webpack's error name.
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (CSS )?chunk .* failed/i;

// Checks that say a reload now would lose work (uploads still running).
const reloadHolds = new Set<() => boolean>();

/**
 * Keeps a failed chunk from reloading the page while `held` returns true:
 * the error goes to the nearest error boundary, whose Reload button leaves
 * the choice to the user. Returns the function that removes the hold.
 */
export function holdReloadWhile(held: () => boolean): () => void {
  reloadHolds.add(held);
  return () => {
    reloadHolds.delete(held);
  };
}

const reloadHeld = () => [...reloadHolds].some((held) => held());

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || CHUNK_ERROR.test(error.message);
}

function readReloadAt(): number {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeReloadAt(time: number): boolean {
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(time));
    return true;
  } catch {
    return false;
  }
}

// Whether this page is the one the last reload opened, and still young
// enough that a chunk failing in it means the reload did not help.
function reloadedRecently(now: number): boolean {
  const reloadAt = readReloadAt();
  if (!reloadAt) return false;
  const pageStart = performance.timeOrigin;
  return pageStart - reloadAt < RELOAD_START_MS && now - pageStart < RELOADED_PAGE_MS;
}

// After a deploy, a tab opened before it names chunks that no longer exist.
// Reloading fetches the current index.html and its chunk names.
export async function loadWithReload<T>(importer: () => Promise<T>): Promise<T> {
  try {
    return await importer();
  } catch (error) {
    if (!isChunkLoadError(error)) throw error;
    const now = Date.now();
    // Recorded by this page: another chunk already started the reload.
    if (readReloadAt() >= performance.timeOrigin) return new Promise<T>(() => {});
    // Without storage there is no loop guard, so no reload either.
    if (reloadHeld() || reloadedRecently(now) || !writeReloadAt(now)) {
      reportClientError('chunk', error);
      throw error;
    }
    window.location.reload();
    // The page is going away; never settling keeps Suspense on its fallback.
    return new Promise<T>(() => {});
  }
}

export function lazyWithReload<P extends object>(
  importer: () => Promise<{ default: ComponentType<P> }>,
) {
  return lazy(() => loadWithReload(importer));
}
