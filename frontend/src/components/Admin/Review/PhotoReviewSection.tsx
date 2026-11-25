import { useCallback, type ReactNode } from 'react';
import { deleteRejectedPhotos, type PhotoPage, type PhotoScope, type StatusFilter } from '../../../api/client';
import type { Gallery, Photo, StatusCounts } from '../../../types';
import { addUploaded } from '../../../utils/photoList';
import PhotoUpload from '../PhotoUpload/PhotoUpload';
import PhotoManager from '../PhotoManager/PhotoManager';
import { usePhotoList } from '../PhotoManager/usePhotoList';
import RejectedBar from './RejectedBar';
import ReviewGrid from './ReviewGrid';
import { StatusPills, ViewSwitch } from './ReviewControls';
import { matchesFilter, useReviewFilter, type ReviewFilter } from './useReviewFilter';
import { useViewMode } from './viewMode';
import styles from './Review.module.css';

export type FetchPhotoPage = (offset: number, limit: number, status: StatusFilter) => Promise<PhotoPage>;

interface PhotoReviewSectionProps {
  // Where uploads go and what Delete all rejected covers.
  scope: Exclude<PhotoScope, 'all'>;
  // The gallery for the Grid's cover, reorder and shuffle; null for Unassigned.
  gallery: Gallery | null;
  // Names the photos' gallery in the Review viewer.
  galleryTitle: string;
  // Memoize it: a new one lists something else.
  fetchPage: FetchPhotoPage;
  // Where the server lists a new upload: first (newest first) or last.
  uploadsGo: 'start' | 'end';
  // After changes that can alter the gallery itself (its cover).
  onGalleryChange?: () => void;
  header: (counts: StatusCounts | null) => ReactNode;
  loading: ReactNode;
}

/**
 * A gallery's or Unassigned's photos for the admin: upload, the status
 * filter with counts, and a Grid / Review switch. Grid is the photo manager
 * with its bulk tools; Review is the public layout with review actions.
 */
export default function PhotoReviewSection(props: PhotoReviewSectionProps) {
  const { fetchPage } = props;
  const fetchCounts = useCallback(() => fetchPage(0, 1, null).then((page) => page.counts), [fetchPage]);
  const filter = useReviewFilter(fetchCounts);
  if (filter.status === undefined) return <>{props.loading}</>;
  return <Section {...props} filter={filter} status={filter.status} />;
}

function Section({
  scope,
  gallery,
  galleryTitle,
  fetchPage,
  uploadsGo,
  onGalleryChange,
  header,
  loading,
  filter,
  status,
}: PhotoReviewSectionProps & { filter: ReviewFilter; status: StatusFilter }) {
  const { counts, setCounts, setStatus, shift, refreshCounts } = filter;
  const [view, setView] = useViewMode();

  const loadPage = useCallback(
    (offset: number, limit: number) =>
      fetchPage(offset, limit, status).then((page) => {
        setCounts(page.counts);
        return page;
      }),
    [fetchPage, status, setCounts]
  );
  const photos = usePhotoList(loadPage, status ?? 'all');
  const { update, reload } = photos;

  const handleUploadComplete = useCallback(
    (photo: Photo) => {
      shift(null, photo.review_status);
      if (matchesFilter(photo.review_status, status)) update((list) => addUploaded(list, photo, uploadsGo));
    },
    [shift, status, update, uploadsGo]
  );

  const handlePhotosChange = useCallback(() => {
    onGalleryChange?.();
    refreshCounts();
  }, [onGalleryChange, refreshCounts]);

  const handleDeleteAll = useCallback(async () => {
    const result = await deleteRejectedPhotos(scope);
    setCounts(result.counts);
    reload();
    onGalleryChange?.();
  }, [scope, setCounts, reload, onGalleryChange]);

  return (
    <>
      {header(counts)}
      <PhotoUpload galleryId={gallery?.id ?? null} onUploadComplete={handleUploadComplete} />

      <div className={styles.toolbar}>
        <StatusPills value={status} counts={counts} onChange={setStatus} />
        <ViewSwitch value={view} onChange={setView} />
      </div>

      {status === 'rejected' && <RejectedBar count={counts?.rejected ?? photos.list.total} onDeleteAll={handleDeleteAll} />}

      {photos.status === 'loading' ? (
        loading
      ) : photos.status === 'error' ? (
        <p className={styles.error} role="alert">
          {photos.error}
        </p>
      ) : view === 'grid' ? (
        <PhotoManager photos={photos} gallery={gallery} statusFilter={status} onPhotosChange={handlePhotosChange} />
      ) : (
        <ReviewGrid photos={photos} filter={status} shift={shift} galleryTitle={galleryTitle} />
      )}
    </>
  );
}
