import { useEffect, useState } from 'react';

export const VIEWER_IDLE_MS = 3000;
// The Zoom plugin's double-tap window (zoom.doubleTapDelay in PhotoGrid.tsx).
// A tap waits this long before it toggles the controls, so the first tap of
// a double tap, which zooms, does not also toggle them.
export const DOUBLE_TAP_MS = 300;
// A touch that moves further than this, or lasts longer, is a swipe, a pan or
// a press, not a tap.
const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 500;

// Capture phase: the lightbox stops some pointer events from propagating
// past its buttons and container.
const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'keydown', 'wheel', 'focusin'] as const;

const isTouch = (event: Event) => {
  const type = (event as PointerEvent).pointerType;
  return type === 'touch' || type === 'pen';
};

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

/**
 * Whether the open viewer's controls (counter, toolbar, caption, arrows) are
 * hidden.
 *
 * With a mouse or keyboard they fade after VIEWER_IDLE_MS without pointer
 * movement, a press or a key, and any of them brings them back. On a touch
 * screen they fade the same way, but only a single tap on the photo brings
 * them back or hides them again: swipes, pans and pinches leave them as they
 * are, and they stay hidden while the photo is zoomed in by touch.
 */
export function useViewerIdle(open: boolean, rootClass: string, zoomed = false): boolean {
  const [idle, setIdle] = useState(false);
  const [touching, setTouching] = useState(false);
  // Read by a pending tap, which outlives the render that armed it.
  const zoomedRef = useLatest(zoomed);

  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendingTap: ReturnType<typeof setTimeout> | undefined;
    let hidden = false;
    let swallowing = false;
    // The touch gesture in progress: where and when it began, and whether it
    // can still be a tap.
    let gesture: { x: number; y: number; at: number; tap: boolean } | null = null;
    const fingers = new Set<number>();

    const setHidden = (value: boolean) => {
      hidden = value;
      setIdle(value);
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (controlHasVisibleFocus(rootClass)) return;
        setHidden(true);
      }, VIEWER_IDLE_MS);
    };
    const show = () => {
      setHidden(false);
      arm();
    };
    // A tap's click is targeted where the finger lifted. A tap meant only to
    // reveal the controls must not press the hidden one under it, so its
    // click is dropped.
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

    const onTouch = (event: PointerEvent) => {
      const id = event.pointerId ?? 0;
      if (event.type === 'pointerdown') {
        stopSwallowing();
        // The first finger of a new touch. Starting afresh drops a finger
        // whose lift was never reported (its slide moved away under it),
        // which would make every later tap look like a pinch.
        if (event.isPrimary) fingers.clear();
        fingers.add(id);
        setTouching(true);
        // A second finger makes a pinch.
        gesture = fingers.size > 1 ? null : { x: event.clientX, y: event.clientY, at: Date.now(), tap: true };
        if (gesture && hidden) {
          swallowing = true;
          window.addEventListener('click', swallowClick, true);
        }
        return;
      }
      if (event.type === 'pointermove') {
        if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > TAP_SLOP_PX) gesture.tap = false;
        return;
      }
      fingers.delete(id);
      const ended = gesture;
      gesture = null;
      if (event.type === 'pointercancel' || !ended?.tap || Date.now() - ended.at > TAP_MAX_MS) {
        stopSwallowing();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (!hidden && target?.closest('button, a[href], input, [role="button"]')) {
        // A tap on a shown control uses it, and keeps the controls up.
        arm();
        return;
      }
      if (pendingTap !== undefined) {
        // The second tap of a double tap, which zooms.
        clearTimeout(pendingTap);
        pendingTap = undefined;
        return;
      }
      pendingTap = setTimeout(() => {
        pendingTap = undefined;
        if (zoomedRef.current) return;
        if (hidden) show();
        else {
          clearTimeout(timer);
          setHidden(true);
        }
      }, DOUBLE_TAP_MS);
    };

    const onActivity = (event: Event) => {
      if (event.type.startsWith('pointer') && isTouch(event)) {
        onTouch(event as PointerEvent);
        return;
      }
      if (event.type === 'pointerup' || event.type === 'pointercancel') return;
      if (event.type === 'pointerdown') {
        stopSwallowing();
        setTouching(false);
      }
      show();
    };

    arm();
    for (const type of ACTIVITY_EVENTS) document.addEventListener(type, onActivity, true);
    return () => {
      clearTimeout(timer);
      clearTimeout(pendingTap);
      stopSwallowing();
      for (const type of ACTIVITY_EVENTS) document.removeEventListener(type, onActivity, true);
      setIdle(false);
      setTouching(false);
    };
  }, [open, rootClass, zoomedRef]);

  return open && (idle || (zoomed && touching));
}

function useLatest<T>(value: T) {
  const [ref] = useState(() => ({ current: value }));
  useEffect(() => {
    ref.current = value;
  }, [ref, value]);
  return ref;
}
