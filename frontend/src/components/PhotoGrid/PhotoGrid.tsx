import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MasonryPhotoAlbum, type RenderExtras, type RenderImage } from 'react-photo-album';
import 'react-photo-album/masonry.css';
import Lightbox, { type ControllerRef } from 'yet-another-react-lightbox';
import 'yet-another-react-lightbox/styles.css';
import Download from 'yet-another-react-lightbox/plugins/download';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import { trackPhotoView, getPhotoDownloadUrl } from '../../api/client';
import { STATUS_LABELS } from '../../utils/reviewStatus';
import ExifOverlay from './ExifOverlay';
import { OriginalLoading, ReviewActions, ViewerLabel, ZoomButtons, type ActOutcome, type ReviewToast, type SetPhotoStatus } from './ViewerChrome';
import type { ReviewStatus } from '../../types';
import { DOUBLE_TAP_MS, useViewerIdle } from './viewerIdle';
import viewerStyles from './Viewer.module.css';
import { createRefreshGuard } from '../../utils/expiredImages';
import {
  GRID_SIZES,
  gridColumns,
  toAlbumPhotos,
  toLightboxSlides,
  type AlbumPhoto,
  type GridPhoto,
  type SlideWithExif,
} from './gridItems';
import styles from './PhotoGrid.module.css';
import { TILE_KEYBOARD_PROPS, useLightboxFocusTrap } from './keyboard';
import { useLightboxHistory } from './lightboxHistory';
import { TILE_IMAGE_PROPS } from './tileImage';
import TileImage from './TileImage';
import { useTileScheduler } from './tileScheduler';
import { createHistoryMemory, entryKey } from '../../utils/historyMemory';
import CollageTiles from './CollageTiles';
import SingleTiles from './SingleTiles';
import { useOriginalOnZoom } from './originalZoom';
import type { GridLayout } from './gridLayout';

/**
 * The admin's Review view: the public layout and viewer, with each photo's
 * state on its tile and in the viewer, and the viewer's review actions in
 * place of downloads. Nothing is counted as a visitor's view.
 */
export interface GridReview {
  onSetStatus: SetPhotoStatus;
  // Whether a photo in this state stays in the list. One that does not
  // leaves it at once (a status filter), and the viewer shows the next.
  keeps: (status: ReviewStatus) => boolean;
  // The last change and its undo, shown above the viewer's actions.
  toast: ReviewToast | null;
  // Names each photo's gallery on its tile (All Photos).
  galleryLabels?: boolean;
}

interface PhotoGridProps {
  photos: GridPhoto[];
  // Unlocks downloads of photos in a private gallery.
  accessToken?: string;
  // Names the gallery in each photo's alt text. Without it a photo's own
  // gallery_title is used when the API joined one.
  galleryTitle?: string;
  // Called when a grid or lightbox image fails to load, which after the page
  // has been open a while means its signed URL expired. The parent refetches
  // the photos; calls are rate limited here.
  onImagesExpired?: () => void;
  // Renders this many tiles at first and as many more each time the visitor
  // nears the end of the grid. The lightbox still moves through every photo.
  tilesPerPage?: number;
  // The history entry (router location key) under which the number of tiles
  // shown is remembered, so Back renders enough of them to reach the
  // position the visitor left.
  tileMemoryKey?: string;
  review?: GridReview;
  // Columns unless set. The collage's arrangement comes from collageSeed.
  layout?: GridLayout;
  collageSeed?: number;
}

const REFRESH_INTERVAL_MS = 60 * 1000;
/**
 * A second review action this soon after one is taken for a double tap and
 * ignored: the viewer has just moved on, and the photo now under the finger
 * is one the admin has not looked at yet.
 */
const ACT_GUARD_MS = 400;
const LIGHTBOX_CLASS = 'photo-grid-lightbox';
const LIGHTBOX_PLUGINS = [Download, Zoom];
// The public download route serves only shown photos.
const REVIEW_PLUGINS = [Zoom];
const TILE_PROPS = { ...TILE_KEYBOARD_PROPS, image: TILE_IMAGE_PROPS };
// More tiles are added while the end of the grid is this far below the
// viewport, so they are laid out before the visitor reaches them and before
// the scheduler, which looks 2.5 screens ahead (tileScheduler.ts), needs them.
const MORE_TILES_MARGIN = '0px 0px 3000px 0px';
const tileCounts = createHistoryMemory('tiles');

function initialTileCount(perPage: number, memoryKey: string | undefined): number {
  const remembered = memoryKey ? (tileCounts.get(entryKey(memoryKey)) ?? 0) : 0;
  return Math.max(perPage, remembered);
}

// The signed URL answers with Content-Disposition: attachment, so navigating
// to it saves the file and leaves the page in place. Navigation, unlike
// opening a tab, is not blocked after the await.
async function downloadOriginal(photoId: string, accessToken?: string) {
  try {
    window.location.assign(await getPhotoDownloadUrl(photoId, accessToken));
  } catch (err) {
    console.error('Failed to download photo:', err);
  }
}

interface PhotoTilesProps {
  photos: AlbumPhoto[];
  onOpen: (index: number) => void;
  review?: boolean;
}

const renderReviewExtras: RenderExtras<AlbumPhoto> = (_, { photo }) => (
  <>
    {photo.status === 'rejected' && <span className={styles.dim} aria-hidden="true" />}
    {photo.status && photo.status !== 'shown' && (
      <span className={`${styles.badge} ${styles[photo.status]}`}>{STATUS_LABELS[photo.status]}</span>
    )}
    {photo.galleryLabel && <span className={styles.galleryLabel}>{photo.galleryLabel}</span>}
  </>
);
// The review extras render after the images, so they paint over both.
const renderTileImage: RenderImage<AlbumPhoto> = (props, { photo }) => <TileImage {...props} photoId={photo.key} />;
const TILE_RENDER = { image: renderTileImage };
const REVIEW_RENDER = { image: renderTileImage, extras: renderReviewExtras };

// Memoized so that moving through the lightbox, which changes only the
// parent's index state, re-renders the lightbox and not every tile. Its props
// must stay referentially stable for that: memoized photos and an open
// callback that changes only with the photos.
const PhotoTiles = memo(function PhotoTiles({ photos, onOpen, review }: PhotoTilesProps) {
  return (
    <MasonryPhotoAlbum
      photos={photos}
      columns={gridColumns}
      spacing={12}
      sizes={GRID_SIZES}
      componentsProps={TILE_PROPS}
      render={review ? REVIEW_RENDER : TILE_RENDER}
      onClick={({ index }) => onOpen(index)}
    />
  );
});

export default function PhotoGrid({
  photos,
  accessToken,
  galleryTitle,
  onImagesExpired,
  tilesPerPage,
  tileMemoryKey,
  review,
  layout = 'columns',
  collageSeed = 1,
}: PhotoGridProps) {
  const lightboxController = useRef<ControllerRef>(null);
  const lightbox = useLightboxHistory(photos, lightboxController);
  const lightboxIndex = lightbox.index;
  // Without IntersectionObserver nothing would add tiles, so all are shown.
  const pageSize = typeof IntersectionObserver === 'undefined' ? undefined : tilesPerPage;
  const [tileCount, setTileCount] = useState(() =>
    pageSize ? initialTileCount(pageSize, tileMemoryKey) : Infinity
  );
  const moreTiles = useRef<HTMLDivElement>(null);
  const trackedPhotoIds = useRef(new Set<string>());
  const gridRef = useRef<HTMLDivElement>(null);
  const [mayRefresh] = useState(() => createRefreshGuard(REFRESH_INTERVAL_MS));
  useLightboxFocusTrap(lightboxIndex >= 0, LIGHTBOX_CLASS, lightboxController);
  useTileScheduler(gridRef);

  // A photo counts once per page view, however often the lightbox returns
  // to it. Keyed by id, since a shuffle moves photos to new indexes.
  useEffect(() => {
    const photo = lightboxIndex >= 0 && !review ? photos[lightboxIndex] : undefined;
    if (photo && !trackedPhotoIds.current.has(photo.id)) {
      trackedPhotoIds.current.add(photo.id);
      trackPhotoView(photo.id);
    }
  }, [lightboxIndex, photos, review]);

  const hasMoreTiles = tileCount < photos.length;
  useEffect(() => {
    const sentinel = moreTiles.current;
    if (!pageSize || !hasMoreTiles || !sentinel) return;
    // A new observer per count reports at once whether the end is still in
    // reach, so a tall screen keeps filling without waiting for a scroll.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setTileCount((n) => n + pageSize);
      },
      { rootMargin: MORE_TILES_MARGIN }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [pageSize, hasMoreTiles, tileCount]);

  useEffect(() => {
    if (tileMemoryKey && pageSize) tileCounts.set(entryKey(tileMemoryKey), tileCount);
  }, [tileMemoryKey, pageSize, tileCount]);

  // Built for every photo, so alt text counts the whole set.
  const galleryLabels = review?.galleryLabels ?? false;
  const albumPhotos = useMemo(
    () => toAlbumPhotos(photos, galleryTitle, { galleryLabels }),
    [photos, galleryTitle, galleryLabels]
  );
  const albumTiles = useMemo(
    () => (tileCount >= albumPhotos.length ? albumPhotos : albumPhotos.slice(0, tileCount)),
    [albumPhotos, tileCount]
  );
  const lightboxSlides = useMemo(() => toLightboxSlides(photos, galleryTitle), [photos, galleryTitle]);
  // The Review view has no download route to sign from, and does not need
  // the original.
  const original = useOriginalOnZoom(lightboxSlides, lightboxIndex, accessToken, LIGHTBOX_CLASS, !review);
  const viewerIdle = useViewerIdle(lightboxIndex >= 0, LIGHTBOX_CLASS, original.zoomed);
  const isOriginal = original.isOriginal;

  // Image error events do not bubble, so they are caught in the capture
  // phase. The lightbox renders in a portal outside the grid and does not
  // expose its images' errors, so its images are matched by class.
  useEffect(() => {
    if (!onImagesExpired) return;
    const handleError = (event: Event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      const ours = gridRef.current?.contains(img) || img.closest(`.${LIGHTBOX_CLASS}`);
      // A failed original leaves the web size on screen (originalZoom.ts).
      if (isOriginal(img.getAttribute('src') ?? '')) return;
      if (ours && mayRefresh()) onImagesExpired();
    };
    document.addEventListener('error', handleError, true);
    return () => document.removeEventListener('error', handleError, true);
  }, [onImagesExpired, mayRefresh, isOriginal]);
  const onSetStatus = review?.onSetStatus;
  const view = lightbox.view;
  const keeps = review?.keeps;
  const close = lightbox.close;
  const lastAct = useRef(-Infinity);
  const reviewAct = useCallback(
    (index: number, status: ReviewStatus): ActOutcome => {
      const photo = photos[index];
      const now = Date.now();
      if (!photo || !onSetStatus || !keeps || now - lastAct.current < ACT_GUARD_MS) return 'ignored';
      const accepted = onSetStatus(photo.id, status);
      if (!accepted) return 'ignored';
      lastAct.current = now;
      if (keeps(status)) {
        if (index >= photos.length - 1) return 'stayed';
        view(index + 1);
        return 'moved';
      }
      // The photo leaves the list, so the next one takes its index; past
      // the end, the viewer starts over at the first photo still listed.
      const remaining = photos.length - 1;
      if (remaining === 0) close();
      else if (index < remaining) view(index, photos[index + 1].id);
      else view(0, photos[0].id);
      return 'moved';
    },
    [photos, onSetStatus, keeps, view, close]
  );

  // Undo from the viewer also shows the photo it put back.
  const toast = review?.toast ?? null;
  const viewerToast = useMemo((): ReviewToast | null => {
    const undo = toast?.undo;
    if (!toast || !undo) return toast;
    return {
      ...toast,
      undo: () => {
        const restored = undo();
        if (restored && lightboxIndex >= 0) view(restored.index, restored.photoId);
        return restored;
      },
    };
  }, [toast, lightboxIndex, view]);

  return (
    <div className={`${styles.grid}${review ? ` ${styles.reviewGrid}` : ''}`} ref={gridRef}>
      {layout === 'collage' && !review ? (
        <CollageTiles photos={albumPhotos} seed={collageSeed} visibleCount={tileCount} onOpen={lightbox.open} />
      ) : layout === 'single' && !review ? (
        <SingleTiles photos={albumTiles} onOpen={lightbox.open} />
      ) : (
        <PhotoTiles photos={albumTiles} onOpen={lightbox.open} review={!!review} />
      )}
      {hasMoreTiles && <div ref={moreTiles} aria-hidden="true" />}

      <Lightbox
        className={`${LIGHTBOX_CLASS} ${viewerStyles.viewer}${viewerIdle ? ` ${viewerStyles.idle}` : ''}`}
        slides={original.slides}
        open={lightboxIndex >= 0}
        index={lightboxIndex}
        close={close}
        on={{
          view: ({ index }) => lightbox.view(index),
          zoom: ({ zoom }) => original.onZoom(zoom),
        }}
        download={{
          download: ({ slide }) => downloadOriginal((slide as SlideWithExif).photoId, accessToken),
        }}
        plugins={review ? REVIEW_PLUGINS : LIGHTBOX_PLUGINS}
        controller={{
          ref: lightboxController,
          closeOnPullUp: true,
          closeOnPullDown: true,
        }}
        zoom={{
          maxZoomPixelRatio: original.maxZoomPixelRatio,
          scrollToZoom: true,
          doubleTapDelay: DOUBLE_TAP_MS,
          doubleClickDelay: 300,
        }}
        render={{
          controls: () => (
            <>
              <ViewerLabel />
              {original.loading && <OriginalLoading />}
              {review && <ReviewActions onAct={reviewAct} toast={viewerToast} />}
            </>
          ),
          buttonZoom: (zoom) => <ZoomButtons {...zoom} />,
          // The review actions take the bottom of the viewer.
          slideFooter: review
            ? undefined
            : ({ slide }) => <ExifOverlay exif={(slide as SlideWithExif).exif} className={viewerStyles.chrome} />,
        }}
      />
    </div>
  );
}
