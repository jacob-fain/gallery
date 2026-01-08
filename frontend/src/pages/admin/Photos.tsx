import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getAllGalleries, getPhotosByGallery } from '../../api/client';
import PhotoUpload from '../../components/Admin/PhotoUpload/PhotoUpload';
import PhotoManager from '../../components/Admin/PhotoManager/PhotoManager';
import type { Photo, Gallery } from '../../types';
import styles from './Photos.module.css';

export default function Photos() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    if (!token || !id) return;

    try {
      // Get gallery info
      const galleries = await getAllGalleries(token);
      const foundGallery = galleries.find((g) => g.id === id);
      if (!foundGallery) {
        setError('Gallery not found');
        setLoading(false);
        return;
      }
      setGallery(foundGallery);

      // Get photos
      const photosData = await getPhotosByGallery(token, id);
      setPhotos(photosData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token, id]);

  const handleUploadComplete = (photo: Photo) => {
    setPhotos((prev) => [...prev, photo]);
  };

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

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

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <Link to="/galleries" className={styles.backLink}>
            &larr; Back to galleries
          </Link>
          <h1 className={styles.title}>{gallery.title}</h1>
          <p className={styles.subtitle}>{photos.length} photos</p>
        </div>
      </div>

      <PhotoUpload galleryId={gallery.id} onUploadComplete={handleUploadComplete} />

      <PhotoManager
        photos={photos}
        gallery={gallery}
        onPhotosChange={fetchData}
      />
    </div>
  );
}
