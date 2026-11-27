import { useEffect, useState } from 'react';

/**
 * Whether the open viewer has seen a pointer go down yet.
 *
 * The Zoom plugin takes a press within its double-tap (or double-click)
 * window of its last press for the second of a pair and zooms in. Its last
 * press starts at 0 on a clock that starts with the page, so the first tap
 * in the first moments after loading a photo link zoomed in by itself. The
 * viewer gives the plugin a window of 0 until a first press has been seen,
 * which the plugin then records as its last press.
 */
export function usePointerSeen(open: boolean): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!open) return;
    // Marked once the press has been handled. React renders an update made
    // during a press before its own listeners run, so marking it at once
    // would hand the plugin the full window for this very press.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onDown = () => {
      timer = setTimeout(() => setSeen(true), 0);
    };
    document.addEventListener('pointerdown', onDown, { capture: true, once: true });
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onDown, { capture: true });
      setSeen(false);
    };
  }, [open]);
  return open && seen;
}
