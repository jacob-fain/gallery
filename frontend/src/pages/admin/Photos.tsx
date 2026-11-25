import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getAllGalleries, getGalleryPhotosPage, type StatusFilter } from '../../api/client';
import PhotoReviewSection from '../../components/Admin/Review/PhotoReviewSection';
import type { Gallery, StatusCounts } from '../../types';
import styles from './Photos.module.css';

export default function Photos() {
  const { id } = useParams<{ id: string }>();
  // Keyed so that moving to another gallery starts from an empty list.
  return id ? <GalleryPhotos key={id} id={id} /> : null;
}

function GalleryPhotos({ id }: { id: string }) {
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchPage = useCallback(
    (offset: number, limit: number, status: StatusFilter) => getGalleryPhotosPage(id, offset, limit, status),
    [id]
  );

  // The gallery itself (title, cover). Photo changes are applied to the list
  // in place, so this is all a change needs to reload. A promise chain rather
  // than an async function: react-hooks/set-state-in-effect counts a setState
  // after an await as synchronous, but not one in a .then callback.
  const fetchGallery = useCallback(
    () =>
      getAllGalleries()
        .then((galleries) => {
          const foundGallery = galleries.find((g) => g.id === id);
          if (foundGallery) setGallery(foundGallery);
          else setError('Gallery not found');
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to load data');
        })
        .finally(() => {
          setGalleryLoading(false);
        }),
    [id]
  );

  useEffect(() => {
    fetchGallery();
  }, [fetchGallery]);

  const loading = <div className={styles.loading}>Loading...</div>;

  if (galleryLoading) return loading;

  if (error || !gallery) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error || 'Gallery not found'}</div>
        <Link to="/galleries" className={styles.backLink}>
          Back to galleries
        </Link>
      </div>
    );
  }

  const header = (counts: StatusCounts | null) => (
    <div className={styles.header}>
      <div>
        <Link to="/galleries" className={styles.backLink}>
          &larr; Back to galleries
        </Link>
        <h1 className={styles.title}>{gallery.title}</h1>
        {counts && (
          <p className={styles.subtitle}>
            {counts.all} photo{counts.all === 1 ? '' : 's'}
          </p>
        )}
      </div>
      <a
        href={`${window.location.origin.replace('manage.', '')}/g/${gallery.slug}`}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.viewGalleryBtn}
      >
        View Gallery ↗
      </a>
    </div>
  );

  return (
    <div className={styles.container}>
      <PhotoReviewSection
        scope={{ galleryId: gallery.id }}
        gallery={gallery}
        galleryTitle={gallery.title}
        fetchPage={fetchPage}
        uploadsGo="end"
        onGalleryChange={fetchGallery}
        header={header}
        loading={loading}
      />
    </div>
  );
}
