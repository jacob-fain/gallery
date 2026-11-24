import { lazy, type ComponentType } from 'react';
import { reportClientError } from './clientErrors';

const RELOAD_KEY = 'chunk-reload-at';
// A reload that happened this recently and still fails to load the chunk
// means a reload will not fix it, so the error propagates instead of looping.
const RELOAD_WINDOW_MS = 10_000;

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

// After a deploy, a cached index.html can name chunks that no longer exist.
// Reloading fetches the current index.html and its chunk names.
export async function loadWithReload<T>(importer: () => Promise<T>): Promise<T> {
  try {
    return await importer();
  } catch (error) {
    const now = Date.now();
    // Without storage there is no loop guard, so no reload either.
    if (now - readReloadAt() < RELOAD_WINDOW_MS || !writeReloadAt(now)) {
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
