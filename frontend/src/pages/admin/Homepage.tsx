import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  getHomepagePhotos,
  setHeroPhoto,
  addToHomepage,
  removeFromHomepage,
  reorderHomepagePhotos,
  getAllGalleries,
  getGalleryPhotosPage,
} from '../../api/client';
import LoadMore from '../../components/Admin/PhotoManager/LoadMore';
import { usePhotoList } from '../../components/Admin/PhotoManager/usePhotoList';
import { useRefreshOnImageError } from '../../components/Admin/PhotoManager/useRefreshOnImageError';
import { withFreshSignedUrls } from '../../utils/expiredImages';
import type { Photo, Gallery } from '../../types';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import styles from './Homepage.module.css';

interface SortablePhotoProps {
  photo: Photo;
  isHero: boolean;
  onMakeHero: (id: string) => void;
  onRemove: (id: string) => void;
}

interface PickerPhotosProps {
  galleryId: string;
  onHomepage: Set<string>;
  onAdd: (id: string) => void;
}

// One instance per chosen gallery (keyed by it), so a slow response for a
// gallery chosen earlier lands in an unmounted instance instead of replacing
// the photos of the one chosen since.
function PickerPhotos({ galleryId, onHomepage, onAdd }: PickerPhotosProps) {
  const loadPage = useCallback(
    (offset: number, limit: number) => getGalleryPhotosPage(galleryId, offset, limit),
    [galleryId]
  );
  const photos = usePhotoList(loadPage);
  const { list } = photos;
  const gridRef = useRef<HTMLDivElement>(null);
  useRefreshOnImageError(gridRef, photos.refreshUrls);

  if (photos.status === 'loading') {
    return <div className={styles.loadingPhotos}>Loading photos...</div>;
  }
  if (photos.status === 'error') {
    return <p className={styles.noPhotos}>{photos.error}</p>;
  }
  if (list.items.length === 0) {
    return <p className={styles.noPhotos}>No photos in this gallery</p>;
  }

  return (
    <div ref={gridRef} className={styles.pickerGrid}>
      {list.items.map((photo) => {
        const isAdded = onHomepage.has(photo.id);
        return (
          <div
            key={photo.id}
            className={`${styles.pickerPhoto} ${isAdded ? styles.added : ''}`}
            onClick={() => !isAdded && onAdd(photo.id)}
          >
            <img src={photo.thumbnailUrl} alt="" loading="lazy" decoding="async" />
            {isAdded && <div className={styles.addedBadge}>Added</div>}
          </div>
        );
      })}
      <LoadMore
        className={styles.pickerLoadMore}
        loaded={list.items.length}
        total={list.total}
        loading={photos.loadingMore}
        failed={photos.moreFailed}
        onLoad={photos.loadMore}
      />
    </div>
  );
}

function SortablePhoto({ photo, isHero, onMakeHero, onRemove }: SortablePhotoProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: photo.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.photoCard} ${isHero ? styles.heroCard : ''} ${isDragging ? styles.dragging : ''}`}
    >
      <div className={styles.dragHandle} {...attributes} {...listeners}>
        <img src={photo.thumbnailUrl} alt="" className={styles.thumbnail} loading="lazy" decoding="async" />
        {isHero && <div className={styles.heroBadge}>Hero</div>}
        {photo.is_hidden && <div className={styles.hiddenBadge}>Hidden</div>}
      </div>
      <div className={styles.photoInfo}>
        <span className={styles.galleryName}>{photo.gallery_title}</span>
        <div className={styles.photoActions}>
          {!isHero && (
            <button
              className={styles.makeHeroBtn}
              onClick={() => onMakeHero(photo.id)}
              disabled={photo.is_hidden}
              title={photo.is_hidden ? 'Show this photo before making it the hero' : undefined}
            >
              Make Hero
            </button>
          )}
          <button
            className={styles.removeBtn}
            onClick={() => onRemove(photo.id)}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Homepage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [selectedGallery, setSelectedGallery] = useState<string>('');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // A promise chain so every setState runs in a callback, which
  // react-hooks/set-state-in-effect accepts from an effect. Clearing the error
  // is the retry button's job, since the first load starts without one.
  const loadPhotos = useCallback(
    () =>
      getHomepagePhotos()
        .then((data) => {
          setPhotos(data);
        })
        .catch((err) => {
          console.error('Failed to load homepage photos:', err);
          setError(err instanceof Error ? err.message : 'Failed to load');
        })
        .finally(() => {
          setLoading(false);
        }),
    []
  );

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  // The picker has a guard of its own; this one covers the hero and featured
  // photos, so neither list's failures use up the other's refresh.
  const featuredRef = useRef<HTMLDivElement>(null);
  const refreshUrls = useCallback(() => {
    getHomepagePhotos()
      .then((fresh) => setPhotos((current) => withFreshSignedUrls(current, fresh)))
      // The photos already shown stay; a failed refresh changes nothing.
      .catch(() => {});
  }, []);
  useRefreshOnImageError(featuredRef, refreshUrls);

  const retryLoad = () => {
    setError(null);
    loadPhotos();
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = photos.findIndex((p) => p.id === active.id);
    const newIndex = photos.findIndex((p) => p.id === over.id);

    const newPhotos = arrayMove(photos, oldIndex, newIndex);
    // Position 0 is the hero, and visitors never see a hidden one.
    if (newPhotos[0].is_hidden && newPhotos[0].id !== photos[0].id) return;
    setPhotos(newPhotos);

    try {
      await reorderHomepagePhotos(newPhotos.map((p) => p.id));
    } catch (err) {
      console.error('Failed to reorder:', err);
      loadPhotos(); // Revert on error
    }
  };

  const handleMakeHero = async (photoId: string) => {
    try {
      const updated = await setHeroPhoto(photoId);
      setPhotos(updated);
    } catch (err) {
      console.error('Failed to set hero:', err);
    }
  };

  const handleRemove = async (photoId: string) => {
    try {
      const updated = await removeFromHomepage(photoId);
      setPhotos(updated);
    } catch (err) {
      console.error('Failed to remove:', err);
    }
  };

  const openPicker = async () => {
    setShowPicker(true);
    try {
      const data = await getAllGalleries();
      setGalleries(data);
    } catch (err) {
      console.error('Failed to load galleries:', err);
    }
  };

  const handleAddPhoto = useCallback(
    async (photoId: string) => {
      try {
        const updated = await addToHomepage(photoId);
        setPhotos(updated);
      } catch (err) {
        console.error('Failed to add photo:', err);
      }
    },
    []
  );

  const homepageIds = useMemo(() => new Set(photos.map((p) => p.id)), [photos]);

  if (loading) {
    return <div className="loading">Loading homepage...</div>;
  }

  if (error) {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Homepage</h1>
        <div className={styles.empty}>
          <p>Error: {error}</p>
          <button onClick={retryLoad} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const heroPhoto = photos[0];
  const featuredPhotos = photos.slice(1);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Homepage</h1>
          <p className={styles.subtitle}>
            Manage the hero image and featured photos on your landing page
          </p>
        </div>
        <button className={styles.addBtn} onClick={openPicker}>
          Add Photos
        </button>
      </header>

      {photos.length === 0 ? (
        <div className={styles.empty}>
          <p>No photos on homepage yet.</p>
          <p>Click "Add Photos" to select photos from your galleries.</p>
        </div>
      ) : (
        <div ref={featuredRef}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Hero Image</h2>
              <p className={styles.sectionDesc}>
                The main background image visitors see first. Drag to reorder.
              </p>
              {heroPhoto?.is_hidden && (
                <p className={styles.heroWarning}>
                  This photo is hidden, so visitors see the next visible featured photo as the
                  hero instead.
                </p>
              )}
              {heroPhoto && (
                <div className={styles.heroPreview}>
                  <SortableContext
                    items={[heroPhoto.id]}
                    strategy={rectSortingStrategy}
                  >
                    <SortablePhoto
                      photo={heroPhoto}
                      isHero={true}
                      onMakeHero={handleMakeHero}
                      onRemove={handleRemove}
                    />
                  </SortableContext>
                </div>
              )}
            </section>
  
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Featured Photos</h2>
              <p className={styles.sectionDesc}>
                Photos shown in the "Selected Work" section below the hero. Drag to reorder.
              </p>
              {featuredPhotos.length > 0 ? (
                <SortableContext
                  items={photos.map((p) => p.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className={styles.grid}>
                    {featuredPhotos.map((photo) => (
                      <SortablePhoto
                        key={photo.id}
                        photo={photo}
                        isHero={false}
                        onMakeHero={handleMakeHero}
                        onRemove={handleRemove}
                      />
                    ))}
                  </div>
                </SortableContext>
              ) : (
                <p className={styles.emptySection}>
                  No featured photos yet. Add more photos to show in the "Selected Work" section.
                </p>
              )}
            </section>
          </DndContext>
        </div>
      )}

      {/* Photo Picker Modal */}
      {showPicker && (
        <div className={styles.modal} onClick={() => setShowPicker(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Add Photos to Homepage</h2>
              <button
                className={styles.closeBtn}
                onClick={() => setShowPicker(false)}
              >
                Close
              </button>
            </div>

            <div className={styles.gallerySelect}>
              <label>Select a gallery:</label>
              <select
                value={selectedGallery}
                onChange={(e) => setSelectedGallery(e.target.value)}
              >
                <option value="">Choose gallery...</option>
                {galleries.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </div>

            {selectedGallery && (
              <PickerPhotos
                key={selectedGallery}
                galleryId={selectedGallery}
                onHomepage={homepageIds}
                onAdd={handleAddPhoto}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
