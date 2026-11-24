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
    let hidden = false;
    let swallowing = false;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (controlHasVisibleFocus(rootClass)) return;
        hidden = true;
        setIdle(true);
      }, VIEWER_IDLE_MS);
    };
    // A touch tap's click is targeted after the finger lifts, by which time
    // the woken controls take pointer events again, so a tap meant only to
    // reveal them would press the hidden one under it. The click of a tap
    // that wakes them is dropped. A mouse needs none of this: its press is
    // already aimed at whatever was under the hidden control.
    const swallowClick = (event: MouseEvent) => {
      stopSwallowing();
      event.preventDefault();
      event.stopPropagation();
    };
    const stopSwallowing = () => {
      if (!swallowing) return;
      swallowing = false;
      window.removeEventListener('click', swallowClick, true);
    };
    const wake = (event: Event) => {
      if (event.type === 'pointerdown') {
        // A gesture that ended without a click (a swipe) leaves nothing to drop.
        stopSwallowing();
        const { pointerType } = event as PointerEvent;
        if (hidden && (pointerType === 'touch' || pointerType === 'pen')) {
          swallowing = true;
          window.addEventListener('click', swallowClick, true);
        }
      }
      hidden = false;
      setIdle(false);
      arm();
    };
    arm();
    for (const type of ACTIVITY_EVENTS) document.addEventListener(type, wake, true);
    return () => {
      clearTimeout(timer);
      stopSwallowing();
      for (const type of ACTIVITY_EVENTS) document.removeEventListener(type, wake, true);
      setIdle(false);
    };
  }, [open, rootClass]);

  return open && idle;
}
