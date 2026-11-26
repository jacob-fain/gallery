import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import PhotoGrid from '../components/PhotoGrid/PhotoGrid';
import { getAllPhotos } from '../api/client';
import { seededOrder } from '../utils/shuffle';
import { withFreshUrls } from '../utils/expiredImages';
import type { PublicPhoto } from '../types';
import LoadError from '../components/StatusMessage/LoadError';
import PageHeading from '../components/PageHeading/PageHeading';
import { DelayedSkeleton, HeadingSkeleton } from '../components/Skeleton/Skeleton';
import PhotoGridSkeleton from '../components/PhotoGrid/PhotoGridSkeleton';
import FloatingControls from '../components/FloatingControls/FloatingControls';
import { useGridLayout } from '../components/PhotoGrid/gridLayout';
import { useEntrySeeds } from '../utils/gridSeeds';
import styles from './AllPhotos.module.css';

// Every photo is fetched, since shuffle and the lightbox need the whole set,
// but laying out hundreds of tiles at once stalls a phone.
const TILES_PER_PAGE = 60;

export default function AllPhotos() {
  const { key: locationKey } = useLocation();
  const [photos, setPhotos] = useState<PublicPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [layout, setLayout, { oneColumn }] = useGridLayout();
  const [seeds, reshuffle] = useEntrySeeds(locationKey);

  // Derived from the photos in the API's order. The whole list is fetched
  // before it is shown (getAllPhotos), so every photo is dealt exactly once,
  // and each photo's place follows from its id, so a refresh or refetch that
  // drops or adds photos leaves the rest where they were.
  const shown = useMemo(
    () => (seeds.shuffle ? seededOrder(photos, seeds.shuffle) : photos),
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
        <FloatingControls layout={layout} onLayoutChange={setLayout} oneColumn={oneColumn} onShuffle={reshuffle} />
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
