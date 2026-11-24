import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getAllGalleries, getGalleryPhotosPage } from '../../api/client';
import PhotoUpload from '../../components/Admin/PhotoUpload/PhotoUpload';
import PhotoManager from '../../components/Admin/PhotoManager/PhotoManager';
import { usePhotoList } from '../../components/Admin/PhotoManager/usePhotoList';
import { addUploaded } from '../../utils/photoList';
import type { Photo, Gallery } from '../../types';
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

  const loadPage = useCallback(
    (offset: number, limit: number) => getGalleryPhotosPage(id, offset, limit),
    [id]
  );
  const photos = usePhotoList(loadPage);
  const { update } = photos;

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

  const handleUploadComplete = useCallback(
    (photo: Photo) => update((list) => addUploaded(list, photo, 'end')),
    [update]
  );

  if (galleryLoading || (photos.status === 'loading' && !error)) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (error || photos.status === 'error' || !gallery) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error || photos.error || 'Gallery not found'}</div>
        <Link to="/galleries" className={styles.backLink}>
          Back to galleries
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <Link to="/galleries" className={styles.backLink}>
            &larr; Back to galleries
          </Link>
          <h1 className={styles.title}>{gallery.title}</h1>
          <p className={styles.subtitle}>{photos.list.total} photos</p>
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

      <PhotoUpload galleryId={gallery.id} onUploadComplete={handleUploadComplete} />

      <PhotoManager
        photos={photos}
        gallery={gallery}
        onPhotosChange={fetchGallery}
      />
    </div>
  );
}
