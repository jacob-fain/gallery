import { useEffect } from 'react';

// A photo tile, in any layout. Its image names the photo (TileImage).
const TILE_SELECTOR = '[data-photo-index], .react-photo-album--photo';
// What else a visitor may be looking at: a page section.
const SECTION_SELECTOR = 'section, article, li';
// The point a third of the way down the screen stands for what is in view.
const PROBE = 1 / 3;
// Across the screen at the probe's height, so a gap between columns still
// finds the photo beside it.
const PROBE_XS = [0.5, 0.3, 0.7, 0.15, 0.85];
// After a width change the page is held on its anchor this long, while
// layouts that follow the width (the collage, the masonry, images sized by
// it) settle.
export const SETTLE_MS = 700;
const INPUTS = ['touchstart', 'wheel', 'keydown'] as const;

interface Anchor {
  // The photo in view, found again by id on every frame: a layout may
  // replace its tiles with new elements as it reflows (the masonry going
  // from one column to two, or Single to Columns on a narrow screen).
  photoId?: string;
  // Anything else in view (a section of the homepage).
  el?: Element;
  // How far down the element the probe point was, as a fraction of it.
  fraction: number;
}

function photoTile(photoId: string): Element | null {
  const id = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(photoId) : photoId;
  const img = document.querySelector(`img[data-photo="${id}"]`);
  return img?.closest(TILE_SELECTOR) ?? img;
}

function anchorElement(anchor: Anchor): Element | null {
  if (anchor.photoId) return photoTile(anchor.photoId);
  return anchor.el?.isConnected ? anchor.el : null;
}

// 'covered' while the viewer is open: the page under it keeps the anchor it
// had before the viewer opened.
function findAnchor(): Anchor | null | 'covered' {
  if (window.scrollY < 1 || typeof document.elementFromPoint !== 'function') return null;
  const width = document.documentElement.clientWidth;
  const y = window.innerHeight * PROBE;
  const fractionOf = (el: Element) => {
    const rect = el.getBoundingClientRect();
    return rect.height > 0 ? (y - rect.top) / rect.height : 0;
  };
  let first: Element | null = null;
  for (const share of PROBE_XS) {
    const hit = document.elementFromPoint(width * share, y);
    if (!hit) continue;
    if (hit.closest('.yarl__root')) return 'covered';
    first ??= hit;
    const tile = hit.closest(TILE_SELECTOR);
    const photoId = tile?.querySelector('img[data-photo]')?.getAttribute('data-photo');
    if (tile && photoId) return { photoId, fraction: fractionOf(tile) };
  }
  if (!first) return null;
  const el = first.closest(SECTION_SELECTOR) ?? first;
  if (el === document.documentElement || el === document.body) return null;
  return { el, fraction: fractionOf(el) };
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
      // The photo held through the last change stays the anchor while it
      // still covers the probe line. Probing afresh could pick its neighbour
      // in another column, and the next turn would drift to that one.
      const kept = anchor?.photoId ? photoTile(anchor.photoId) : null;
      if (kept && anchor) {
        const rect = kept.getBoundingClientRect();
        const y = window.innerHeight * PROBE;
        if (rect.top <= y && rect.bottom >= y && rect.height > 0) {
          anchor = { photoId: anchor.photoId, fraction: (y - rect.top) / rect.height };
          return;
        }
      }
      const found = findAnchor();
      if (found !== 'covered') anchor = found;
    };
    const onScroll = () => {
      if (!captureFrame) captureFrame = requestAnimationFrame(capture);
    };
    // One read and one write per frame, so the hold does not thrash layout.
    const hold = () => {
      frame = 0;
      if (Date.now() >= holdUntil) {
        capture();
        return;
      }
      const el = anchor && anchorElement(anchor);
      if (anchor && el) {
        const rect = el.getBoundingClientRect();
        const offset = rect.top + anchor.fraction * rect.height - window.innerHeight * PROBE;
        if (Math.abs(offset) >= 1) window.scrollBy(0, offset);
      }
      frame = requestAnimationFrame(hold);
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
