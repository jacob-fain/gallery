import { useEffect, useState } from 'react';
import GalleryCard from '../components/GalleryCard/GalleryCard';
import { getGalleries } from '../api/client';
import type { Gallery } from '../types';
import styles from './Home.module.css';

export default function Home() {
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await getGalleries();
        setGalleries(data);
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

  if (galleries.length === 0) {
    return (
      <div className="loading">
        No galleries yet. Check back soon!
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        {galleries.map((gallery) => (
          <GalleryCard key={gallery.id} gallery={gallery} />
        ))}
      </div>
    </div>
  );
}
