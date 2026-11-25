import { useLayoutEffect, useRef, useState } from 'react';
import type { ReviewStatus } from '../../types';
import { STATUS_ACTIONS } from '../../utils/reviewStatus';
import {
  IconButton,
  createIcon,
  useController,
  useLightboxState,
  type ZoomRef,
} from 'yet-another-react-lightbox';
import { viewerLabel, type SlideWithExif } from './gridItems';
import styles from './Viewer.module.css';

// Top left, opposite the toolbar. Replaces the Counter plugin's bottom corner.
export function ViewerLabel() {
  const { slides, currentIndex } = useLightboxState();
  const { toolbarWidth } = useController();
  if (slides.length === 0) return null;
  return (
    <div
      className={`${styles.label} ${styles.chrome}`}
      // Long gallery names end in an ellipsis short of the toolbar.
      style={toolbarWidth ? { maxWidth: `calc(100% - ${toolbarWidth}px)` } : undefined}
    >
      {viewerLabel(slides[currentIndex] as SlideWithExif | undefined, currentIndex, slides.length)}
    </div>
  );
}

// The Zoom plugin's own icons are not exported.
const ZoomInIcon = createIcon(
  'ZoomIn',
  <>
    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    <path d="M12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z" />
  </>
);
const ZoomOutIcon = createIcon(
  'ZoomOut',
  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z" />
);

type ZoomButtonsProps = Pick<ZoomRef, 'zoom' | 'minZoom' | 'maxZoom' | 'disabled' | 'zoomIn' | 'zoomOut'>;

// Zoom out shows only while zoomed in. Like the plugin's own buttons, a
// button hidden or disabled while it has focus hands focus to its sibling (or
// the lightbox), so focus is never dropped on the page.
export function ZoomButtons({ zoom, minZoom, maxZoom, disabled, zoomIn, zoomOut }: ZoomButtonsProps) {
  const { focus } = useController();
  const zoomInRef = useRef<HTMLButtonElement>(null);
  const zoomOutRef = useRef<HTMLButtonElement>(null);
  const focused = useRef<'in' | 'out' | null>(null);
  const zoomedIn = !disabled && zoom > minZoom;
  const zoomInDisabled = disabled || zoom >= maxZoom;

  useLayoutEffect(() => {
    if (focused.current === 'out' && !zoomedIn) {
      focused.current = null;
      if (zoomInDisabled) focus();
      else zoomInRef.current?.focus();
    } else if (focused.current === 'in' && zoomInDisabled) {
      focused.current = null;
      if (zoomedIn) zoomOutRef.current?.focus();
      else focus();
    }
  }, [zoomedIn, zoomInDisabled, focus]);

  return (
    <>
      <IconButton
        ref={zoomInRef}
        label="Zoom in"
        icon={ZoomInIcon}
        disabled={zoomInDisabled}
        onClick={zoomIn}
        onFocus={() => {
          focused.current = 'in';
        }}
        onBlur={() => {
          if (focused.current === 'in') focused.current = null;
        }}
      />
      {/* Hidden rather than unmounted, so it still holds focus when the
          layout effect hands focus on. */}
      <IconButton
        ref={zoomOutRef}
        label="Zoom out"
        icon={ZoomOutIcon}
        hidden={!zoomedIn}
        disabled={!zoomedIn}
        onClick={zoomOut}
        onFocus={() => {
          focused.current = 'out';
        }}
        onBlur={() => {
          if (focused.current === 'out') focused.current = null;
        }}
      />
    </>
  );
}

/**
 * Saves a photo's new state. Resolves with an error message when the change
 * failed and was put back, or null when it was saved.
 */
export type SetPhotoStatus = (photoId: string, status: ReviewStatus) => Promise<string | null>;

/**
 * Acts on the photo at `index` and moves the viewer on to the next one, in
 * the same update: the lightbox goes back to its index prop whenever its
 * slides change, so moving with the controller and then changing the slide
 * would land on the same photo again.
 */
export type ReviewAct = (index: number, status: ReviewStatus) => Promise<string | null>;

// The actions each state offers, in the order shown: every state but its own.
const ACTIONS: Record<ReviewStatus, ReviewStatus[]> = {
  review: ['shown', 'rejected'],
  shown: ['rejected', 'review'],
  rejected: ['shown', 'review'],
};

const ACTION_ICONS: Record<ReviewStatus, React.ReactNode> = {
  shown: <path d="M5 12l5 5L20 7" />,
  rejected: <path d="M6 6l12 12M18 6 6 18" />,
  review: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
};

type Notice = { kind: 'end'; index: number } | { kind: 'error'; text: string };

/**
 * The admin viewer's actions along the bottom. Each acts at once and moves
 * on to the next photo; on the last photo the viewer stays and says so.
 * Deliberately no keyboard shortcuts: arrow keys already move between
 * photos, and a stray key must not publish one.
 */
export function ReviewActions({ onAct }: { onAct: ReviewAct }) {
  const { slides, currentIndex } = useLightboxState();
  const [notice, setNotice] = useState<Notice | null>(null);
  const slide = slides[currentIndex] as SlideWithExif | undefined;
  if (!slide?.status) return null;
  const status = slide.status;

  const act = (to: ReviewStatus) => {
    const last = currentIndex >= slides.length - 1;
    setNotice(last ? { kind: 'end', index: currentIndex } : null);
    onAct(currentIndex, to).then((error) => {
      if (error) setNotice({ kind: 'error', text: error });
    });
  };

  const message =
    notice?.kind === 'error'
      ? notice.text
      : notice?.kind === 'end' && notice.index === currentIndex
        ? 'That was the last photo in this list.'
        : null;

  return (
    <div className={`${styles.actions} ${styles.chrome}`}>
      {message && (
        <p className={styles.notice} role={notice?.kind === 'error' ? 'alert' : 'status'}>
          {message}
        </p>
      )}
      <div className={styles.actionButtons}>
        {ACTIONS[status].map((to) => (
          <button
            key={to}
            type="button"
            className={`${styles.action} ${to === 'shown' ? styles.primary : ''}`}
            onClick={() => act(to)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              {ACTION_ICONS[to]}
            </svg>
            {STATUS_ACTIONS[to]}
          </button>
        ))}
      </div>
    </div>
  );
}
