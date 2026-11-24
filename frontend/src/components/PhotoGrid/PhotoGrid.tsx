import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { MasonryPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/masonry.css';
import Lightbox, { type ControllerRef } from 'yet-another-react-lightbox';
import 'yet-another-react-lightbox/styles.css';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Download from 'yet-another-react-lightbox/plugins/download';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/plugins/counter.css';
import type { PublicPhoto } from '../../types';
import { trackPhotoView, getPhotoDownloadUrl } from '../../api/client';
import ExifOverlay from './ExifOverlay';
import { createRefreshGuard } from '../../utils/expiredImages';
import {
  GRID_SIZES,
  gridColumns,
  toAlbumPhotos,
  toLightboxSlides,
  type AlbumPhoto,
  type SlideWithExif,
} from './gridItems';
import styles from './PhotoGrid.module.css';
import { TILE_KEYBOARD_PROPS, useLightboxFocusTrap, useLightboxHistory } from './keyboard';

interface PhotoGridProps {
  photos: PublicPhoto[];
  // Unlocks downloads of photos in a private gallery.
  accessToken?: string;
  // Names the gallery in each photo's alt text. Without it a photo's own
  // gallery_title is used when the API joined one.
  galleryTitle?: string;
  // Called when a grid or lightbox image fails to load, which after the page
  // has been open a while means its signed URL expired. The parent refetches
  // the photos; calls are rate limited here.
  onImagesExpired?: () => void;
}

const REFRESH_INTERVAL_MS = 60 * 1000;
const LIGHTBOX_CLASS = 'photo-grid-lightbox';
const LIGHTBOX_PLUGINS = [Counter, Download, Zoom];

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
}

// Memoized so that moving through the lightbox, which changes only the
// parent's index state, re-renders the lightbox and not every tile. Its props
// must stay referentially stable for that: memoized photos and a state setter.
const PhotoTiles = memo(function PhotoTiles({ photos, onOpen }: PhotoTilesProps) {
  return (
    <MasonryPhotoAlbum
      photos={photos}
      columns={gridColumns}
      spacing={12}
      sizes={GRID_SIZES}
      componentsProps={TILE_KEYBOARD_PROPS}
      onClick={({ index }) => onOpen(index)}
    />
  );
});

export default function PhotoGrid({ photos, accessToken, galleryTitle, onImagesExpired }: PhotoGridProps) {
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const lastTrackedIndex = useRef(-1);
  const gridRef = useRef<HTMLDivElement>(null);
  const [mayRefresh] = useState(() => createRefreshGuard(REFRESH_INTERVAL_MS));
  const lightboxController = useRef<ControllerRef>(null);
  useLightboxFocusTrap(lightboxIndex >= 0, LIGHTBOX_CLASS, lightboxController);
  useLightboxHistory(lightboxIndex >= 0, lightboxController);

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

  // Track photo view when lightbox opens or navigates to a new photo
  useEffect(() => {
    if (lightboxIndex >= 0 && lightboxIndex !== lastTrackedIndex.current) {
      const photo = photos[lightboxIndex];
      if (photo) {
        trackPhotoView(photo.id);
        lastTrackedIndex.current = lightboxIndex;
      }
    }
    // Reset tracking when lightbox closes
    if (lightboxIndex < 0) {
      lastTrackedIndex.current = -1;
    }
  }, [lightboxIndex, photos]);

  const albumPhotos = useMemo(() => toAlbumPhotos(photos, galleryTitle), [photos, galleryTitle]);
  const lightboxSlides = useMemo(() => toLightboxSlides(photos, galleryTitle), [photos, galleryTitle]);

  return (
    <div className={styles.grid} ref={gridRef}>
      <PhotoTiles photos={albumPhotos} onOpen={setLightboxIndex} />

      <Lightbox
        className={LIGHTBOX_CLASS}
        slides={lightboxSlides}
        open={lightboxIndex >= 0}
        index={lightboxIndex}
        close={() => setLightboxIndex(-1)}
        on={{
          view: ({ index }) => setLightboxIndex(index),
        }}
        download={{
          download: ({ slide }) => downloadOriginal((slide as SlideWithExif).photoId, accessToken),
        }}
        plugins={LIGHTBOX_PLUGINS}
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
        counter={{ container: { style: { top: 'unset', bottom: 0, left: 'unset', right: 0 } } }}
        render={{
          slideFooter: ({ slide }) => (
            <ExifOverlay exif={(slide as SlideWithExif).exif} />
          ),
        }}
      />
    </div>
  );
}
