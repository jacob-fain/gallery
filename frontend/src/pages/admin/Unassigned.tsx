import { useCallback } from 'react';
import { getUnassignedPhotosPage, type StatusFilter } from '../../api/client';
import PhotoReviewSection from '../../components/Admin/Review/PhotoReviewSection';
import type { StatusCounts } from '../../types';
import styles from './Unassigned.module.css';

export default function Unassigned() {
  const fetchPage = useCallback(
    (offset: number, limit: number, status: StatusFilter) => getUnassignedPhotosPage(offset, limit, status),
    []
  );

  const header = (counts: StatusCounts | null) => (
    <div className={styles.header}>
      <div>
        <h1 className={styles.title}>Unassigned Photos</h1>
        {counts && (
          <p className={styles.subtitle}>
            {counts.all} photo{counts.all === 1 ? '' : 's'} waiting to be assigned. Select photos and use
            Move to file them into a gallery.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className={styles.container}>
      <PhotoReviewSection
        scope="unassigned"
        gallery={null}
        galleryTitle="Unassigned"
        fetchPage={fetchPage}
        // Unassigned photos list newest first, so an upload goes on top.
        uploadsGo="start"
        header={header}
        loading={<div className={styles.loading}>Loading...</div>}
      />
    </div>
  );
}
