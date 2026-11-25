import { useCallback, useEffect, useMemo } from 'react';
import { setPhotosStatus, type StatusFilter } from '../../../api/client';
import type { Photo, ReviewStatus } from '../../../types';
import { hasMore, mapPhotos, removePhotos } from '../../../utils/photoList';
import { emptyListMessage } from '../../../utils/reviewStatus';
import PhotoGrid from '../../PhotoGrid/PhotoGrid';
import type { GridPhoto } from '../../PhotoGrid/gridItems';
import type { PhotoListHandle } from '../PhotoManager/usePhotoList';
import { matchesFilter, type ReviewFilter } from './useReviewFilter';
import styles from './Review.module.css';

interface ReviewGridProps {
  photos: PhotoListHandle;
  filter: StatusFilter;
  shift: ReviewFilter['shift'];
  // The gallery every photo is in; without it each photo's own is named.
  galleryTitle?: string;
  // Names each photo's gallery on its tile (All Photos).
  galleryLabels?: boolean;
}

const toGridPhoto = (photo: Photo): GridPhoto => ({
  id: photo.id,
  gallery_id: photo.gallery_id,
  width: photo.width,
  height: photo.height,
  exif_data: photo.exif_data ?? null,
  webUrl: photo.webUrl ?? '',
  thumbnailUrl: photo.thumbnailUrl ?? '',
  gallery_title: photo.gallery_title ?? (photo.gallery_id ? null : 'Unassigned'),
  review_status: photo.review_status,
});

/**
 * The Review view: the list in the public site's masonry and viewer (the
 * same PhotoGrid), with review actions in the viewer. The viewer walks the
 * whole filtered list, so every page is loaded. A photo acted on stays in
 * the list until the viewer closes, so n / N holds still and Back to review
 * can undo; on close, photos that left the filter leave the list.
 */
export default function ReviewGrid({ photos, filter, shift, galleryTitle, galleryLabels }: ReviewGridProps) {
  const { list, update, latest, loadAll, refreshUrls, status } = photos;
  const more = hasMore(list);

  useEffect(() => {
    if (status === 'ready' && more && !photos.moreFailed) loadAll();
  }, [status, more, loadAll, photos.moreFailed]);

  const gridPhotos = useMemo(() => list.items.map(toGridPhoto), [list.items]);

  // Optimistic, and put back when the request fails.
  const onSetStatus = useCallback(
    async (photoId: string, to: ReviewStatus): Promise<string | null> => {
      const from = latest().items.find((p) => p.id === photoId)?.review_status;
      if (!from || from === to) return null;
      const set = (s: ReviewStatus) =>
        update((l) => mapPhotos(l, (p) => (p.id === photoId ? { ...p, review_status: s } : p)));
      set(to);
      shift(from, to);
      try {
        await setPhotosStatus([photoId], to);
        return null;
      } catch (err) {
        set(from);
        shift(to, from);
        return `${err instanceof Error ? err.message : 'Request failed'}: the photo was not changed.`;
      }
    },
    [latest, update, shift]
  );

  const onClose = useCallback(() => {
    const gone = latest()
      .items.filter((p) => !matchesFilter(p.review_status, filter))
      .map((p) => p.id);
    if (gone.length) update((l) => removePhotos(l, gone));
  }, [latest, update, filter]);

  const review = useMemo(() => ({ onSetStatus, onClose, galleryLabels }), [onSetStatus, onClose, galleryLabels]);

  if (list.items.length === 0 && !more) {
    return <p className={styles.empty}>{emptyListMessage(filter)}</p>;
  }

  return (
    <>
      <PhotoGrid photos={gridPhotos} galleryTitle={galleryTitle} onImagesExpired={refreshUrls} review={review} />
      {more && (
        <p className={styles.loadingMore} role="status">
          {photos.moreFailed ? (
            <button type="button" className={styles.retry} onClick={() => loadAll()}>
              Loading failed. Retry
            </button>
          ) : (
            `Loading ${list.total - list.items.length} more...`
          )}
        </p>
      )}
    </>
  );
}
