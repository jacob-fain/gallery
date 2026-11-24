import { useCallback } from 'react';
import { useAuth } from '../../contexts/auth';
import { getUnassignedPhotosPage } from '../../api/client';
import PhotoUpload from '../../components/Admin/PhotoUpload/PhotoUpload';
import PhotoManager from '../../components/Admin/PhotoManager/PhotoManager';
import { usePhotoList } from '../../components/Admin/PhotoManager/usePhotoList';
import { addUploaded } from '../../utils/photoList';
import type { Photo } from '../../types';
import styles from './Unassigned.module.css';

export default function Unassigned() {
  const { token } = useAuth();

  const loadPage = useCallback(
    (offset: number, limit: number) => getUnassignedPhotosPage(token ?? '', offset, limit),
    [token]
  );
  const photos = usePhotoList(loadPage);
  const { update } = photos;
  const total = photos.list.total;

  // Unassigned photos list newest first, so an upload goes on top.
  const handleUploadComplete = useCallback(
    (photo: Photo) => update((list) => addUploaded(list, photo, 'start')),
    [update]
  );

  if (photos.status === 'loading') {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (photos.status === 'error') {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{photos.error}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Unassigned Photos</h1>
          <p className={styles.subtitle}>
            {total} photo{total === 1 ? '' : 's'} waiting to be
            assigned. Select photos and use Move to file them into a gallery.
          </p>
        </div>
      </div>

      <PhotoUpload galleryId={null} onUploadComplete={handleUploadComplete} />

      <PhotoManager photos={photos} gallery={null} />
    </div>
  );
}
