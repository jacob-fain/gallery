import { useEffect, useState } from 'react';
import { getGalleries } from '../api/client';
import GalleryCard from '../components/GalleryCard/GalleryCard';
import type { Gallery } from '../types';
import LoadError from '../components/StatusMessage/LoadError';
import PageHeading from '../components/PageHeading/PageHeading';
import { DelayedSkeleton, HeadingSkeleton, SkeletonBlock } from '../components/Skeleton/Skeleton';
import styles from './Galleries.module.css';

const SKELETON_CARDS = 4;

function GalleriesSkeleton() {
  return (
    <DelayedSkeleton>
      <HeadingSkeleton />
      <div className={styles.container}>
        <div className={styles.grid}>
          {Array.from({ length: SKELETON_CARDS }, (_, i) => (
            <SkeletonBlock key={i} className={styles.coverSkeleton} />
          ))}
        </div>
      </div>
    </DelayedSkeleton>
  );
}

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
    return <GalleriesSkeleton />;
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

  return (
    <>
      <PageHeading title="Galleries" />
      {galleries.length === 0 ? (
        <div className="loading">No galleries yet. Check back soon!</div>
      ) : (
        <div className={styles.container}>
          <div className={styles.grid}>
            {galleries.map((gallery) => (
              <GalleryCard key={gallery.id} gallery={gallery} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
