import { useEffect } from 'react';

// What a visitor is looking at: a photo tile, or a page section.
const ANCHOR_SELECTOR = '[data-photo-index], .react-photo-album--photo, section, article, li';
// The point a third of the way down the screen stands for what is in view.
const PROBE = 1 / 3;
// After a width change the page is held on its anchor this long, while
// layouts that follow the width (the collage, the masonry, images sized by
// it) settle.
export const SETTLE_MS = 700;
const INPUTS = ['touchstart', 'wheel', 'keydown'] as const;

interface Anchor {
  el: Element;
  // How far down the element the probe point was, as a fraction of it.
  fraction: number;
}

// 'covered' while the viewer is open: the page under it keeps the anchor it
// had before the viewer opened.
function findAnchor(): Anchor | null | 'covered' {
  if (window.scrollY < 1 || typeof document.elementFromPoint !== 'function') return null;
  const x = document.documentElement.clientWidth / 2;
  const y = window.innerHeight * PROBE;
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  if (hit.closest('.yarl__root')) return 'covered';
  const el = hit.closest(ANCHOR_SELECTOR) ?? hit;
  if (el === document.documentElement || el === document.body) return null;
  const rect = el.getBoundingClientRect();
  return { el, fraction: rect.height > 0 ? (y - rect.top) / rect.height : 0 };
}

/**
 * Keeps what the visitor was looking at on screen when the page's width
 * changes (a phone rotated, a window resized). Every layout reflows to the
 * new width, so the same scroll offset lands on other photos, often far
 * from where the visitor was. Height-only changes, such as a phone's toolbar
 * showing and hiding, are left to the browser.
 */
export default function RotationAnchor() {
  useEffect(() => {
    let anchor: Anchor | null = null;
    let width = document.documentElement.clientWidth;
    let holdUntil = 0;
    let frame = 0;
    let captureFrame = 0;

    const capture = () => {
      captureFrame = 0;
      if (Date.now() < holdUntil) return;
      const found = findAnchor();
      if (found !== 'covered') anchor = found;
    };
    const onScroll = () => {
      if (!captureFrame) captureFrame = requestAnimationFrame(capture);
    };
    // One read and one write per frame, so the hold does not thrash layout.
    const hold = () => {
      frame = 0;
      if (anchor?.el.isConnected) {
        const rect = anchor.el.getBoundingClientRect();
        const offset = rect.top + anchor.fraction * rect.height - window.innerHeight * PROBE;
        if (Math.abs(offset) >= 1) window.scrollBy(0, offset);
      }
      if (Date.now() < holdUntil) frame = requestAnimationFrame(hold);
      else capture();
    };
    const onResize = () => {
      const next = document.documentElement.clientWidth;
      if (next === width) return;
      width = next;
      holdUntil = Date.now() + SETTLE_MS;
      if (!frame) frame = requestAnimationFrame(hold);
    };
    // A visitor who scrolls during the hold takes over.
    const release = () => {
      holdUntil = 0;
    };

    capture();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    for (const type of INPUTS) window.addEventListener(type, release, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(captureFrame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      for (const type of INPUTS) window.removeEventListener(type, release);
    };
  }, []);
  return null;
}
