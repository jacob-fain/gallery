import { useLayoutEffect, useRef } from 'react';
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
