import { useEffect, useState } from 'react';

export const VIEWER_IDLE_MS = 3000;

// Capture phase: the lightbox stops some pointer events from propagating
// past its buttons and container.
const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focusin'] as const;

// A control reached with the keyboard keeps its focus ring on screen, so the
// controls do not fade while one has it. A clicked control keeps focus too,
// but without :focus-visible, and that one may fade.
function controlHasVisibleFocus(rootClass: string): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.closest(`.${rootClass}`)) return false;
  if (!active.matches('button, a[href], input')) return false;
  try {
    return active.matches(':focus-visible');
  } catch {
    return true;
  }
}

// True once the open viewer has seen no pointer movement, tap or key press
// for VIEWER_IDLE_MS; any of them makes it false again.
export function useViewerIdle(open: boolean, rootClass: string): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!controlHasVisibleFocus(rootClass)) setIdle(true);
      }, VIEWER_IDLE_MS);
    };
    const wake = () => {
      setIdle(false);
      arm();
    };
    arm();
    for (const type of ACTIVITY_EVENTS) document.addEventListener(type, wake, true);
    return () => {
      clearTimeout(timer);
      for (const type of ACTIVITY_EVENTS) document.removeEventListener(type, wake, true);
      setIdle(false);
    };
  }, [open, rootClass]);

  return open && idle;
}
