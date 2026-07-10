import { useEffect, useState } from 'react';
import PhotoGrid from '../components/PhotoGrid/PhotoGrid';
import { getAllPhotos } from '../api/client';
import { shuffle } from '../utils/shuffle';
import type { Photo } from '../types';
import styles from './AllPhotos.module.css';

export default function AllPhotos() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await getAllPhotos();
        setPhotos(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load photos');
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

  return (
    <div className={styles.container}>
      {photos.length > 0 && (
        <button
          className={styles.shuffleBtn}
          onClick={() => setPhotos(shuffle(photos))}
          title="Shuffle photos"
          aria-label="Shuffle photos"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
            <path d="m18 2 4 4-4 4" />
            <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" />
            <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
            <path d="m18 14 4 4-4 4" />
          </svg>
        </button>
      )}
      {photos.length === 0 ? (
        <div className="loading">No photos yet. Check back soon!</div>
      ) : (
        <PhotoGrid photos={photos} />
      )}
    </div>
  );
}
