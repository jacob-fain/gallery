import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PhotoGrid from '../components/PhotoGrid/PhotoGrid';
import { getGallery, getGalleryPhotos } from '../api/client';
import type { Gallery as GalleryType, Photo } from '../types';
import styles from './Gallery.module.css';

export default function Gallery() {
  const { slug } = useParams<{ slug: string }>();
  const [gallery, setGallery] = useState<GalleryType | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!slug) return;

      try {
        const [galleryData, photosData] = await Promise.all([
          getGallery(slug),
          getGalleryPhotos(slug),
        ]);
        setGallery(galleryData);
        setPhotos(photosData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load gallery');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [slug]);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (!gallery) {
    return <div className="error">Gallery not found</div>;
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{gallery.title}</h1>
        {gallery.description && (
          <p className={styles.description}>{gallery.description}</p>
        )}
      </header>

      {photos.length === 0 ? (
        <div className="loading">No photos in this gallery yet.</div>
      ) : (
        <PhotoGrid photos={photos} />
      )}
    </div>
  );
}
