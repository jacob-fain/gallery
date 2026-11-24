import { useEffect, useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { createHistoryMemory, entryKey } from '../utils/historyMemory';

const positions = createHistoryMemory('scroll');

// Long enough for a cached or quick API answer and the grid's first layout;
// past it the page is scrolled as far toward the position as it can go.
export const RESTORE_TIMEOUT_MS = 2000;
const POLL_MS = 50;

/**
 * Back and Forward return to the scroll position the entry was left at; any
 * other navigation starts at the top. The photo pages load their content
 * after the route renders, so the browser's own restoration would run against
 * an empty page: this one waits until the page is tall enough to reach the
 * position. Entries that differ only by the lightbox's photo share a location
 * key, so opening and closing a photo moves nothing.
 */
export default function ScrollRestorer() {
  const { key } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    const target = navigationType === 'POP' ? (positions.get(entryKey(key)) ?? 0) : 0;
    if (target === 0) {
      window.scrollTo(0, 0);
      return;
    }

    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const reachable = document.documentElement.scrollHeight - window.innerHeight >= target;
      if (reachable || Date.now() - started >= RESTORE_TIMEOUT_MS) {
        stop();
        window.scrollTo(0, target);
        return;
      }
      timer = setTimeout(attempt, POLL_MS);
    };
    // A visitor who starts scrolling while the page loads keeps control.
    const INPUTS = ['wheel', 'touchstart', 'keydown'] as const;
    const stop = () => {
      clearTimeout(timer);
      for (const type of INPUTS) window.removeEventListener(type, stop);
    };
    for (const type of INPUTS) window.addEventListener(type, stop, { passive: true });
    attempt();
    return stop;
  }, [key, navigationType]);

  // Records the position from scroll events, never by reading scrollY when
  // the location changes: by then the next page may have rendered and the
  // browser clamped the position to its height. Set up after the restore
  // above, so it starts from the position that one set; every cleanup runs
  // before either is set up again, so the entry left is saved before the
  // next one is read.
  useLayoutEffect(() => {
    const entry = entryKey(key);
    let latest = window.scrollY;
    const onScroll = () => {
      latest = window.scrollY;
    };
    const save = () => positions.set(entry, latest);
    window.addEventListener('scroll', onScroll, { passive: true });
    // A reload or leaving the site ends the document without a cleanup.
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [key]);

  return null;
}
