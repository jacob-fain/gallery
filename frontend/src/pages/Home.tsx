import { useEffect, useState } from 'react';
import PhotoGrid from '../components/PhotoGrid/PhotoGrid';
import { getFeaturedPhotos } from '../api/client';
import type { Photo } from '../types';

export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await getFeaturedPhotos();
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

  if (photos.length === 0) {
    return (
      <div className="loading">
        No featured photos yet. Check back soon!
      </div>
    );
  }

  return <PhotoGrid photos={photos} />;
}
