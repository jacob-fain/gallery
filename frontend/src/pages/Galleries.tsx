import { useEffect, useState } from 'react';
import { getGalleries } from '../api/client';
import GalleryCard from '../components/GalleryCard/GalleryCard';
import type { Gallery } from '../types';
import LoadError from '../components/StatusMessage/LoadError';
import styles from './Galleries.module.css';

export default function Galleries() {
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const data = await getGalleries();
        setGalleries(data);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [attempt]);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (failed) {
    return (
      <LoadError
        onRetry={() => {
          setFailed(false);
          setLoading(true);
          setAttempt((n) => n + 1);
        }}
      />
    );
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
