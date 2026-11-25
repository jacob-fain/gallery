import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MasonryPhotoAlbum, type RenderExtras } from 'react-photo-album';
import 'react-photo-album/masonry.css';
import Lightbox, { type ControllerRef } from 'yet-another-react-lightbox';
import 'yet-another-react-lightbox/styles.css';
import Download from 'yet-another-react-lightbox/plugins/download';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import { trackPhotoView, getPhotoDownloadUrl } from '../../api/client';
import { STATUS_LABELS } from '../../utils/reviewStatus';
import ExifOverlay from './ExifOverlay';
import { ReviewActions, ViewerLabel, ZoomButtons, type SetPhotoStatus } from './ViewerChrome';
import type { ReviewStatus } from '../../types';
import { useViewerIdle } from './viewerIdle';
import viewerStyles from './Viewer.module.css';
import { IMAGE_FADE_PROPS } from '../../utils/imageFade';
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
import { createHistoryMemory, entryKey } from '../../utils/historyMemory';

/**
 * The admin's Review view: the public layout and viewer, with each photo's
 * state on its tile and in the viewer, and the viewer's review actions in
 * place of downloads. Nothing is counted as a visitor's view.
 */
export interface GridReview {
  onSetStatus: SetPhotoStatus;
  // Called when the viewer closes.
  onClose?: () => void;
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
}

const REFRESH_INTERVAL_MS = 60 * 1000;
const LIGHTBOX_CLASS = 'photo-grid-lightbox';
const LIGHTBOX_PLUGINS = [Download, Zoom];
// The public download route serves only shown photos.
const REVIEW_PLUGINS = [Zoom];
const TILE_PROPS = { ...TILE_KEYBOARD_PROPS, image: IMAGE_FADE_PROPS };
// More tiles are added while the end of the grid is this far below the
// viewport, so they are laid out before the visitor reaches them.
const MORE_TILES_MARGIN = '0px 0px 1500px 0px';
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
const REVIEW_RENDER = { extras: renderReviewExtras };

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
      render={review ? REVIEW_RENDER : undefined}
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
  const viewerIdle = useViewerIdle(lightboxIndex >= 0, LIGHTBOX_CLASS);

  // Image error events do not bubble, so they are caught in the capture
  // phase. The lightbox renders in a portal outside the grid and does not
  // expose its images' errors, so its images are matched by class.
  useEffect(() => {
    if (!onImagesExpired) return;
    const handleError = (event: Event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      const ours = gridRef.current?.contains(img) || img.closest(`.${LIGHTBOX_CLASS}`);
      if (ours && mayRefresh()) onImagesExpired();
    };
    document.addEventListener('error', handleError, true);
    return () => document.removeEventListener('error', handleError, true);
  }, [onImagesExpired, mayRefresh]);

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
  const onSetStatus = review?.onSetStatus;
  const view = lightbox.view;
  const reviewAct = useCallback(
    (index: number, status: ReviewStatus) => {
      const photo = photos[index];
      if (!photo || !onSetStatus) return Promise.resolve(null);
      if (index < photos.length - 1) view(index + 1);
      return onSetStatus(photo.id, status);
    },
    [photos, onSetStatus, view]
  );
  const onReviewClose = review?.onClose;
  const close = lightbox.close;
  const closeViewer = useCallback(() => {
    close();
    onReviewClose?.();
  }, [close, onReviewClose]);

  return (
    <div className={`${styles.grid}${review ? ` ${styles.reviewGrid}` : ''}`} ref={gridRef}>
      <PhotoTiles photos={albumTiles} onOpen={lightbox.open} review={!!review} />
      {hasMoreTiles && <div ref={moreTiles} aria-hidden="true" />}

      <Lightbox
        className={`${LIGHTBOX_CLASS} ${viewerStyles.viewer}${viewerIdle ? ` ${viewerStyles.idle}` : ''}`}
        slides={lightboxSlides}
        open={lightboxIndex >= 0}
        index={lightboxIndex}
        close={closeViewer}
        on={{
          view: ({ index }) => lightbox.view(index),
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
          maxZoomPixelRatio: 3,
          scrollToZoom: true,
          doubleTapDelay: 300,
          doubleClickDelay: 300,
        }}
        render={{
          controls: () => (
            <>
              <ViewerLabel />
              {review && <ReviewActions onAct={reviewAct} />}
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
