import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getGalleries, getAllPhotos } from '../api/client';
import GalleryCard from '../components/GalleryCard/GalleryCard';
import cardStyles from '../components/GalleryCard/GalleryCard.module.css';
import type { Gallery, Photo } from '../types';
import styles from './Galleries.module.css';

export default function Galleries() {
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [coverPhoto, setCoverPhoto] = useState<Photo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        // Most recent photo doubles as the All Photos card cover
        const [galleriesData, recentPhotos] = await Promise.all([
          getGalleries(),
          getAllPhotos(1).catch(() => []),
        ]);
        setGalleries(galleriesData);
        setCoverPhoto(recentPhotos[0] || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load galleries');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (galleries.length === 0 && !coverPhoto) {
    return (
      <div className="loading">
        No galleries yet. Check back soon!
      </div>
    );
  }

  const allPhotosCoverUrl =
    coverPhoto?.thumbnailUrl ||
    'https://placehold.co/600x400/1a1a1a/ffffff?text=All%20Photos';

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Galleries</h1>
      <div className={styles.grid}>
        <Link to="/photos" className={cardStyles.card}>
          <div className={cardStyles.imageWrapper}>
            <img src={allPhotosCoverUrl} alt="All Photos" className={cardStyles.image} />
            <div className={cardStyles.overlay}>
              <span className={cardStyles.title}>All Photos</span>
            </div>
          </div>
        </Link>
        {galleries.map((gallery) => (
          <GalleryCard key={gallery.id} gallery={gallery} />
        ))}
      </div>
    </div>
  );
}
