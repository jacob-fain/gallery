import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import PhotoGrid from '../components/PhotoGrid/PhotoGrid';
import { getAllPhotos } from '../api/client';
import { shuffle } from '../utils/shuffle';
import { withFreshUrls } from '../utils/expiredImages';
import type { PublicPhoto } from '../types';
import LoadError from '../components/StatusMessage/LoadError';
import PageHeading from '../components/PageHeading/PageHeading';
import { DelayedSkeleton, HeadingSkeleton } from '../components/Skeleton/Skeleton';
import PhotoGridSkeleton from '../components/PhotoGrid/PhotoGridSkeleton';
import LayoutSwitch from '../components/PhotoGrid/LayoutSwitch';
import { useGridLayout } from '../components/PhotoGrid/gridLayout';
import { randomSeed, seededRandom } from '../components/PhotoGrid/collage';
import { createHistoryMemory, entryKey } from '../utils/historyMemory';
import styles from './AllPhotos.module.css';

// Every photo is fetched, since shuffle and the lightbox need the whole set,
// but laying out hundreds of tiles at once stalls a phone.
const TILES_PER_PAGE = 60;

// Kept per history entry, so Back to the page (or a reload of it) deals the
// same order and collage again. A shuffle seed of 0 is the API's order.
const layoutSeeds = createHistoryMemory('collageSeed');
const shuffleSeeds = createHistoryMemory('shuffleSeed');

interface Seeds {
  layout: number;
  shuffle: number;
}

function initialSeeds(locationKey: string): Seeds {
  const key = entryKey(locationKey);
  return { layout: layoutSeeds.get(key) ?? randomSeed(), shuffle: shuffleSeeds.get(key) ?? 0 };
}

export default function AllPhotos() {
  const { key: locationKey } = useLocation();
  const [photos, setPhotos] = useState<PublicPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [layout, setLayout] = useGridLayout();
  const [seeds, setSeeds] = useState(() => initialSeeds(locationKey));

  useEffect(() => {
    const key = entryKey(locationKey);
    layoutSeeds.set(key, seeds.layout);
    shuffleSeeds.set(key, seeds.shuffle);
  }, [locationKey, seeds]);

  // Derived from the photos in the API's order, so refreshed URLs keep the
  // shuffled order.
  const shown = useMemo(
    () => (seeds.shuffle ? shuffle(photos, seededRandom(seeds.shuffle)) : photos),
    [photos, seeds.shuffle]
  );

  const refreshPhotos = useCallback(() => {
    getAllPhotos(undefined, { fresh: true })
      .then((fresh) => setPhotos((current) => withFreshUrls(current, fresh)))
      // The photos already shown stay; a failed refresh changes nothing.
      .catch(() => {});
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const data = await getAllPhotos();
        setPhotos(data);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [attempt]);

  if (loading) {
    return (
      <DelayedSkeleton>
        <HeadingSkeleton />
        <PhotoGridSkeleton />
      </DelayedSkeleton>
    );
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
    <div className={styles.container}>
      <PageHeading title="All Photos" />
      {photos.length > 0 && (
        <LayoutSwitch layout={layout} onChange={setLayout} className={styles.layoutSwitch} />
      )}
      {photos.length > 0 && (
        <button
          className={styles.shuffleBtn}
          onClick={() => setSeeds({ layout: randomSeed(), shuffle: randomSeed() })}
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
        <PhotoGrid
          photos={shown}
          onImagesExpired={refreshPhotos}
          tilesPerPage={TILES_PER_PAGE}
          tileMemoryKey={locationKey}
          layout={layout}
          collageSeed={seeds.layout}
        />
      )}
    </div>
  );
}
