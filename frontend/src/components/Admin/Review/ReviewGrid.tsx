import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setPhotosStatus, type StatusFilter } from '../../../api/client';
import type { Photo, ReviewStatus } from '../../../types';
import { hasMore, insertPhoto, mapPhotos, removePhotos } from '../../../utils/photoList';
import { emptyListMessage, STATUS_DONE } from '../../../utils/reviewStatus';
import PhotoGrid from '../../PhotoGrid/PhotoGrid';
import type { GridPhoto } from '../../PhotoGrid/gridItems';
import { ReviewToastMessage, type ReviewToast } from '../../PhotoGrid/ViewerChrome';
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

const TOAST_MS = 5000;

const failed = (err: unknown) => (err instanceof Error ? err.message : 'Request failed');

/**
 * The Review view: the list in the public site's masonry and viewer (the
 * same PhotoGrid), with review actions in the viewer. The viewer walks the
 * whole filtered list, so every page is loaded. A photo whose new state is
 * outside the filter leaves the list at once; under All it stays. Each
 * change can be undone from the toast it shows, which puts the photo back
 * where it was.
 */
export default function ReviewGrid({ photos, filter, shift, galleryTitle, galleryLabels }: ReviewGridProps) {
  const { list, update, latest, loadAll, refreshUrls, status } = photos;
  const more = hasMore(list);
  const [toast, setToast] = useState<ReviewToast | null>(null);
  // The last photo left the list and the viewer closed.
  const [allDone, setAllDone] = useState(false);
  const toastSeq = useRef(0);
  // Photos with a save on its way, so a double tap cannot send a second
  // change before the first is settled.
  const saving = useRef(new Map<string, number>());

  useEffect(() => {
    if (status === 'ready' && more && !photos.moreFailed) loadAll();
  }, [status, more, loadAll, photos.moreFailed]);

  useEffect(() => {
    if (!toast || toast.error) return;
    const id = toast.id;
    const timer = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const gridPhotos = useMemo(() => list.items.map(toGridPhoto), [list.items]);

  const keeps = useCallback((s: ReviewStatus) => matchesFilter(s, filter), [filter]);

  // Optimistic: the list changes at once, and goes back when the save fails.
  const onSetStatus = useCallback(
    (photoId: string, to: ReviewStatus): boolean => {
      const items = latest().items;
      const index = items.findIndex((p) => p.id === photoId);
      const before = items[index];
      if (!before || before.review_status === to || saving.current.has(photoId)) return false;
      const from = before.review_status;
      const leaves = !matchesFilter(to, filter);
      const setTo = (s: ReviewStatus) =>
        update((l) => mapPhotos(l, (p) => (p.id === photoId ? { ...p, review_status: s } : p)));
      const apply = () => {
        if (leaves) update((l) => removePhotos(l, [photoId]));
        else setTo(to);
        shift(from, to);
      };
      const restore = () => {
        if (leaves) update((l) => insertPhoto(l, before, index));
        else setTo(from);
        shift(to, from);
      };
      const hold = () => saving.current.set(photoId, (saving.current.get(photoId) ?? 0) + 1);
      const release = () => {
        const n = (saving.current.get(photoId) ?? 1) - 1;
        if (n > 0) saving.current.set(photoId, n);
        else saving.current.delete(photoId);
      };
      const show = (next: Omit<ReviewToast, 'id'>) => setToast({ ...next, id: ++toastSeq.current });

      let undone = false;
      apply();
      hold();
      const after = latest();
      setAllDone(after.items.length === 0 && !hasMore(after));
      const saved = setPhotosStatus([photoId], to)
        .then(
          () => true,
          (err) => {
            if (!undone) {
              undone = true;
              restore();
              setAllDone(false);
              show({ text: `${failed(err)}: the photo was not changed.`, error: true });
            }
            return false;
          }
        )
        .finally(release);

      const undo = () => {
        if (undone) return null;
        undone = true;
        restore();
        setAllDone(false);
        setToast(null);
        hold();
        // Sent once the change itself is settled, so the two cannot arrive
        // out of order. A change that failed was already put back.
        saved
          .then((ok) => (ok ? setPhotosStatus([photoId], from) : undefined))
          .catch((err) => {
            apply();
            show({ text: `${failed(err)}: the undo was not saved.`, error: true });
          })
          .finally(release);
        const at = latest().items.findIndex((p) => p.id === photoId);
        return at >= 0 ? { index: at, photoId } : null;
      };

      show({ text: STATUS_DONE[to], undo });
      return true;
    },
    [latest, update, shift, filter]
  );

  const review = useMemo(() => ({ onSetStatus, keeps, toast, galleryLabels }), [onSetStatus, keeps, toast, galleryLabels]);

  if (list.items.length === 0 && !more) {
    return (
      <>
        <p className={styles.empty}>{emptyListMessage(filter)}</p>
        {toast && (
          <ReviewToastMessage
            key={toast.id}
            toast={allDone && !toast.error ? { ...toast, text: `All done. ${toast.text}` } : toast}
            className={styles.pageToast}
          />
        )}
      </>
    );
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
