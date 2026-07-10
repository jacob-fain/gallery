import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getUnassignedPhotos } from '../../api/client';
import PhotoUpload from '../../components/Admin/PhotoUpload/PhotoUpload';
import PhotoManager from '../../components/Admin/PhotoManager/PhotoManager';
import type { Photo } from '../../types';
import styles from './Unassigned.module.css';

export default function Unassigned() {
  const { token } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    if (!token) return;

    try {
      const photosData = await getUnassignedPhotos(token);
      setPhotos(photosData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token]);

  const handleUploadComplete = (photo: Photo) => {
    setPhotos((prev) => [photo, ...prev]);
  };

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Unassigned Photos</h1>
          <p className={styles.subtitle}>
            {photos.length} photo{photos.length === 1 ? '' : 's'} waiting to be
            assigned. Select photos and use Move to file them into a gallery.
          </p>
        </div>
      </div>

      <PhotoUpload galleryId={null} onUploadComplete={handleUploadComplete} />

      <PhotoManager
        photos={photos}
        gallery={null}
        onPhotosChange={fetchData}
      />
    </div>
  );
}
