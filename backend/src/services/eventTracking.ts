import { query } from '../config/db';
import { logger } from '../utils/logger';
import type { GalleryAccessPayload } from '../types';

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
        logger.error(`Failed to record ${label}`, { err });
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

// Only shown photos are counted. The UPDATE doubles as that check and as the
// lookup of the photo's gallery for the event row.
const PHOTO_EVENT_SQL = (counter: 'view_count' | 'download_count', eventType: string) =>
  `WITH counted AS (
     UPDATE photos SET ${counter} = ${counter} + 1
     WHERE id = $1 AND review_status = 'shown'
     RETURNING id, gallery_id
   )
   INSERT INTO analytics_events (event_type, gallery_id, photo_id)
   SELECT '${eventType}', gallery_id, id FROM counted`;

const PHOTO_VIEW_SQL = PHOTO_EVENT_SQL('view_count', 'photo_view');
const PHOTO_DOWNLOAD_SQL = PHOTO_EVENT_SQL('download_count', 'photo_download');

// A gallery view counts when the visitor can open the gallery: it is public,
// or the visitor holds a current access token for it ($2 and $3, its gallery
// id and access version, null without one). The UPDATE doubles as that check
// and as the lookup of the id by slug.
const GALLERY_VIEW_SQL = `WITH counted AS (
     UPDATE galleries SET view_count = view_count + 1
     WHERE slug = $1 AND (is_public = true OR (id = $2 AND access_version = $3))
     RETURNING id
   )
   INSERT INTO analytics_events (event_type, gallery_id)
   SELECT 'gallery_view', id FROM counted`;

const GALLERY_DOWNLOAD_SQL = `INSERT INTO analytics_events (event_type, gallery_id) VALUES ('gallery_download', $1)`;

export const recordPhotoView = (photoId: string) =>
  track('photo view', () => query(PHOTO_VIEW_SQL, [photoId]));

export const recordPhotoDownload = (photoId: string) =>
  track('photo download', () => query(PHOTO_DOWNLOAD_SQL, [photoId]));

export const recordGalleryView = (slug: string, access: GalleryAccessPayload | null) =>
  track('gallery view', () =>
    query(GALLERY_VIEW_SQL, [slug, access?.galleryId ?? null, access?.accessVersion ?? null])
  );

export const recordGalleryDownload = (galleryId: string) =>
  track('gallery download', () => query(GALLERY_DOWNLOAD_SQL, [galleryId]));
