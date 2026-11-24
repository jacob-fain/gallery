import { query } from '../config/db';

/**
 * View and download counts are recorded off the response path: a visitor
 * never waits on, or sees an error from, an analytics write. Each write is
 * one statement, started immediately and never buffered, so a crash loses
 * only the writes already in flight. Graceful shutdown waits for them with
 * drainTracking() before closing the pool.
 */
const inFlight = new Set<Promise<void>>();

export const track = (label: string, write: () => Promise<unknown>): void => {
  const pending: Promise<void> = Promise.resolve()
    .then(write)
    .then(
      () => undefined,
      (err: unknown) => {
        console.error(`Failed to record ${label}:`, err instanceof Error ? err.message : err);
      }
    )
    .finally(() => inFlight.delete(pending));
  inFlight.add(pending);
};

export const drainTracking = async (): Promise<void> => {
  while (inFlight.size > 0) {
    await Promise.all([...inFlight]);
  }
};

// Hidden photos are not counted. The UPDATE doubles as that check and as the
// lookup of the photo's gallery for the event row.
const PHOTO_EVENT_SQL = (counter: 'view_count' | 'download_count', eventType: string) =>
  `WITH counted AS (
     UPDATE photos SET ${counter} = ${counter} + 1
     WHERE id = $1 AND is_hidden = false
     RETURNING id, gallery_id
   )
   INSERT INTO analytics_events (event_type, gallery_id, photo_id)
   SELECT '${eventType}', gallery_id, id FROM counted`;

const PHOTO_VIEW_SQL = PHOTO_EVENT_SQL('view_count', 'photo_view');
const PHOTO_DOWNLOAD_SQL = PHOTO_EVENT_SQL('download_count', 'photo_download');

const GALLERY_VIEW_SQL = `WITH counted AS (
     UPDATE galleries SET view_count = view_count + 1 WHERE id = $1 RETURNING id
   )
   INSERT INTO analytics_events (event_type, gallery_id)
   SELECT 'gallery_view', id FROM counted`;

const GALLERY_DOWNLOAD_SQL = `INSERT INTO analytics_events (event_type, gallery_id) VALUES ('gallery_download', $1)`;

export const recordPhotoView = (photoId: string) =>
  track('photo view', () => query(PHOTO_VIEW_SQL, [photoId]));

export const recordPhotoDownload = (photoId: string) =>
  track('photo download', () => query(PHOTO_DOWNLOAD_SQL, [photoId]));

export const recordGalleryView = (galleryId: string) =>
  track('gallery view', () => query(GALLERY_VIEW_SQL, [galleryId]));

export const recordGalleryDownload = (galleryId: string) =>
  track('gallery download', () => query(GALLERY_DOWNLOAD_SQL, [galleryId]));
