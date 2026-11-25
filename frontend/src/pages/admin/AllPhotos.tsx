import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteRejectedPhotos,
  getAdminPhotosPage,
  getAllGalleries,
  type PhotoScope,
  type StatusFilter,
} from '../../api/client';
import { usePhotoList } from '../../components/Admin/PhotoManager/usePhotoList';
import RejectedBar from '../../components/Admin/Review/RejectedBar';
import ReviewGrid from '../../components/Admin/Review/ReviewGrid';
import { StatusPills } from '../../components/Admin/Review/ReviewControls';
import { useReviewFilter, type ReviewFilter } from '../../components/Admin/Review/useReviewFilter';
import reviewStyles from '../../components/Admin/Review/Review.module.css';
import type { Gallery } from '../../types';
import styles from './Photos.module.css';

// The select's values: gallery ids are UUIDs, so neither name can collide.
const scopeOf = (value: string): PhotoScope =>
  value === 'all' || value === 'unassigned' ? value : { galleryId: value };

/**
 * Every photo across galleries and Unassigned, newest first, in the public
 * layout with review actions and each photo's gallery on its tile.
 */
export default function AllPhotos() {
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [scopeValue, setScopeValue] = useState('all');

  useEffect(() => {
    getAllGalleries()
      .then(setGalleries)
      .catch(() => {
        // The select offers All galleries and Unassigned without the list.
      });
  }, []);

  const fetchCounts = useCallback(
    () => getAdminPhotosPage(scopeOf(scopeValue), 0, 1).then((page) => page.counts),
    [scopeValue]
  );
  const filter = useReviewFilter(fetchCounts);
  const loading = <div className={styles.loading}>Loading...</div>;

  return (
    <div className={styles.container}>
      <div className={reviewStyles.toolbar}>
        <div>
          <h1 className={styles.title}>All Photos</h1>
          {filter.counts && (
            <p className={styles.subtitle}>
              {filter.counts.all} photo{filter.counts.all === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <div className={reviewStyles.toolbarEnd}>
          <label className={reviewStyles.gallerySelect}>
            Gallery
            <select value={scopeValue} onChange={(e) => setScopeValue(e.target.value)}>
              <option value="all">All galleries</option>
              <option value="unassigned">Unassigned</option>
              {galleries.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <StatusPills value={filter.status} counts={filter.counts} onChange={filter.setStatus} />
        </div>
      </div>
      {filter.status === undefined ? (
        loading
      ) : (
        <AllPhotosList scopeValue={scopeValue} filter={filter} status={filter.status} loading={loading} />
      )}
    </div>
  );
}

function AllPhotosList({
  scopeValue,
  filter,
  status,
  loading,
}: {
  scopeValue: string;
  filter: ReviewFilter;
  status: StatusFilter;
  loading: React.ReactNode;
}) {
  const { counts, setCounts, shift } = filter;
  const scope = useMemo(() => scopeOf(scopeValue), [scopeValue]);
  const loadPage = useCallback(
    (offset: number, limit: number) =>
      getAdminPhotosPage(scope, offset, limit, status).then((page) => {
        setCounts(page.counts);
        return page;
      }),
    [scope, status, setCounts]
  );
  const photos = usePhotoList(loadPage, `${scopeValue}:${status ?? 'all'}`);
  const { reload } = photos;

  const handleDeleteAll = useCallback(async () => {
    const result = await deleteRejectedPhotos(scope);
    setCounts(result.counts);
    reload();
  }, [scope, setCounts, reload]);

  return (
    <>
      {status === 'rejected' && (
        <RejectedBar count={counts?.rejected ?? photos.list.total} onDeleteAll={handleDeleteAll} />
      )}
      {photos.status === 'loading' ? (
        loading
      ) : photos.status === 'error' ? (
        <p className={reviewStyles.error} role="alert">
          {photos.error}
        </p>
      ) : (
        <div className={photos.stale ? reviewStyles.stale : undefined} aria-busy={photos.stale} inert={photos.stale}>
          <ReviewGrid photos={photos} filter={status} shift={shift} galleryLabels />
        </div>
      )}
    </>
  );
}
