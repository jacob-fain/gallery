import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import type { ControllerRef } from 'yet-another-react-lightbox';

const TILE_INDEX = 'data-photo-index';

// The masonry renders each column as its own element, so DOM order, and with
// it the browser's Tab order, runs down one column before the next. Each photo
// is placed at the top of the shortest column, so index order is top to bottom
// reading order, the order the lightbox counts in. Tab follows that instead.
function tabInReadingOrder(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
  const index = Number((event.target as HTMLElement).getAttribute(TILE_INDEX) ?? NaN);
  if (Number.isNaN(index)) return;

  const tiles = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(`[${TILE_INDEX}]`));
  const step = event.shiftKey ? -1 : 1;
  const next = tiles.find((tile) => Number(tile.getAttribute(TILE_INDEX)) === index + step);
  if (next) {
    event.preventDefault();
    next.focus();
    return;
  }
  // Leaving the album: the browser moves on from whichever element has focus
  // when it handles the key, so start it from the album's DOM edge.
  (event.shiftKey ? tiles[0] : tiles[tiles.length - 1])?.focus();
}

export const TILE_KEYBOARD_PROPS = {
  container: { onKeyDown: tabInReadingOrder },
  button: ({ index }: { index: number }) => ({ [TILE_INDEX]: index }) as Record<string, number>,
};

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The lightbox marks the rest of the page inert while it is open, but after
// its last control Tab still leaves for the document itself, where its
// Escape handler (on its own container) no longer hears keys.
export function useLightboxFocusTrap(
  open: boolean,
  lightboxClass: string,
  controller: RefObject<ControllerRef | null>
) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const root = document.querySelector<HTMLElement>(`.${lightboxClass}`);
      if (!root) return;
      const inside = event.target instanceof Node && root.contains(event.target);
      if (event.key === 'Escape') {
        if (!inside) controller.current?.close();
        return;
      }
      if (event.key !== 'Tab') return;
      // Slides other than the current one are inert.
      const controls = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.closest('[inert]')
      );
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const onControl = active !== null && controls.includes(active);
      if (!onControl || active === (event.shiftKey ? first : last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, lightboxClass, controller]);
}
