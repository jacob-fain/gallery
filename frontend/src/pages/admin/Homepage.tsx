import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getHomepagePhotos,
  setHeroPhoto,
  addToHomepage,
  removeFromHomepage,
  reorderHomepagePhotos,
  getAllGalleries,
  getPhotosByGallery,
} from '../../api/client';
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
        <img src={photo.thumbnailUrl} alt="" className={styles.thumbnail} />
        {isHero && <div className={styles.heroBadge}>Hero</div>}
      </div>
      <div className={styles.photoInfo}>
        <span className={styles.galleryName}>{photo.gallery_title}</span>
        <div className={styles.photoActions}>
          {!isHero && (
            <button
              className={styles.makeHeroBtn}
              onClick={() => onMakeHero(photo.id)}
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
  const { token } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [selectedGallery, setSelectedGallery] = useState<string>('');
  const [galleryPhotos, setGalleryPhotos] = useState<Photo[]>([]);
  const [loadingGalleryPhotos, setLoadingGalleryPhotos] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const loadPhotos = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const data = await getHomepagePhotos(token);
      setPhotos(data);
    } catch (err) {
      console.error('Failed to load homepage photos:', err);
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !token) return;

    const oldIndex = photos.findIndex((p) => p.id === active.id);
    const newIndex = photos.findIndex((p) => p.id === over.id);

    const newPhotos = arrayMove(photos, oldIndex, newIndex);
    setPhotos(newPhotos);

    try {
      await reorderHomepagePhotos(token, newPhotos.map((p) => p.id));
    } catch (err) {
      console.error('Failed to reorder:', err);
      loadPhotos(); // Revert on error
    }
  };

  const handleMakeHero = async (photoId: string) => {
    if (!token) return;
    try {
      const updated = await setHeroPhoto(token, photoId);
      setPhotos(updated);
    } catch (err) {
      console.error('Failed to set hero:', err);
    }
  };

  const handleRemove = async (photoId: string) => {
    if (!token) return;
    try {
      const updated = await removeFromHomepage(token, photoId);
      setPhotos(updated);
    } catch (err) {
      console.error('Failed to remove:', err);
    }
  };

  const openPicker = async () => {
    if (!token) return;
    setShowPicker(true);
    try {
      const data = await getAllGalleries(token);
      setGalleries(data);
    } catch (err) {
      console.error('Failed to load galleries:', err);
    }
  };

  const handleGallerySelect = async (galleryId: string) => {
    if (!token || !galleryId) return;
    setSelectedGallery(galleryId);
    setLoadingGalleryPhotos(true);
    try {
      const data = await getPhotosByGallery(token, galleryId);
      setGalleryPhotos(data);
    } catch (err) {
      console.error('Failed to load gallery photos:', err);
    } finally {
      setLoadingGalleryPhotos(false);
    }
  };

  const handleAddPhoto = async (photoId: string) => {
    if (!token) return;
    try {
      const updated = await addToHomepage(token, photoId);
      setPhotos(updated);
      // Update gallery photos to reflect the change
      setGalleryPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, is_featured: true } : p))
      );
    } catch (err) {
      console.error('Failed to add photo:', err);
    }
  };

  const isPhotoOnHomepage = (photoId: string) => {
    return photos.some((p) => p.id === photoId);
  };

  if (loading) {
    return <div className="loading">Loading homepage...</div>;
  }

  if (error) {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Homepage</h1>
        <div className={styles.empty}>
          <p>Error: {error}</p>
          <button onClick={loadPhotos} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
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
                onChange={(e) => handleGallerySelect(e.target.value)}
              >
                <option value="">Choose gallery...</option>
                {galleries.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </div>

            {loadingGalleryPhotos ? (
              <div className={styles.loadingPhotos}>Loading photos...</div>
            ) : galleryPhotos.length > 0 ? (
              <div className={styles.pickerGrid}>
                {galleryPhotos.map((photo) => {
                  const isAdded = isPhotoOnHomepage(photo.id);
                  return (
                    <div
                      key={photo.id}
                      className={`${styles.pickerPhoto} ${isAdded ? styles.added : ''}`}
                      onClick={() => !isAdded && handleAddPhoto(photo.id)}
                    >
                      <img src={photo.thumbnailUrl} alt="" />
                      {isAdded && <div className={styles.addedBadge}>Added</div>}
                    </div>
                  );
                })}
              </div>
            ) : selectedGallery ? (
              <p className={styles.noPhotos}>No photos in this gallery</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
