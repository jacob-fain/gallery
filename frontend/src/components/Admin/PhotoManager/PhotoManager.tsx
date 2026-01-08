import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../../../contexts/AuthContext';
import { updatePhoto, deletePhoto, setCoverImage, reorderPhotos } from '../../../api/client';
import type { Photo, Gallery } from '../../../types';
import styles from './PhotoManager.module.css';

interface PhotoManagerProps {
  photos: Photo[];
  gallery: Gallery;
  onPhotosChange: () => void;
}

interface SortablePhotoCardProps {
  photo: Photo;
  gallery: Gallery;
  onToggleFeatured: (photo: Photo) => void;
  onSetCover: (photoId: string) => void;
  onDelete: (photoId: string) => void;
}

function SortablePhotoCard({
  photo,
  gallery,
  onToggleFeatured,
  onSetCover,
  onDelete,
}: SortablePhotoCardProps) {
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
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.card} ${isDragging ? styles.dragging : ''}`}
    >
      <div
        className={styles.imageWrapper}
        {...attributes}
        {...listeners}
      >
        <img
          src={photo.thumbnailUrl}
          alt={photo.original_filename}
          className={styles.image}
        />
        {gallery.cover_image_id === photo.id && (
          <span className={styles.coverBadge}>Cover</span>
        )}
        {photo.is_featured && (
          <span className={styles.featuredBadge}>Featured</span>
        )}
        <div className={styles.dragHint}>Drag to reorder</div>
      </div>
      <div className={styles.info}>
        <div className={styles.filename}>{photo.original_filename}</div>
        <div className={styles.meta}>
          {photo.width}x{photo.height} &bull;{' '}
          {(photo.file_size / 1024).toFixed(0)}KB
        </div>
      </div>
      <div className={styles.actions}>
        <button
          className={`${styles.actionBtn} ${
            photo.is_featured ? styles.active : ''
          }`}
          onClick={() => onToggleFeatured(photo)}
          title={photo.is_featured ? 'Remove from featured' : 'Add to featured'}
        >
          {photo.is_featured ? 'Unfeature' : 'Feature'}
        </button>
        <button
          className={styles.actionBtn}
          onClick={() => onSetCover(photo.id)}
          disabled={gallery.cover_image_id === photo.id}
        >
          Set Cover
        </button>
        <button
          className={`${styles.actionBtn} ${styles.danger}`}
          onClick={() => onDelete(photo.id)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default function PhotoManager({
  photos,
  gallery,
  onPhotosChange,
}: PhotoManagerProps) {
  const { token } = useAuth();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [localPhotos, setLocalPhotos] = useState<Photo[]>(photos);

  // Update local photos when props change
  if (photos !== localPhotos && photos.length !== localPhotos.length) {
    setLocalPhotos(photos);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = localPhotos.findIndex((p) => p.id === active.id);
      const newIndex = localPhotos.findIndex((p) => p.id === over.id);

      const newOrder = arrayMove(localPhotos, oldIndex, newIndex);
      setLocalPhotos(newOrder);

      // Save to backend
      if (token) {
        try {
          await reorderPhotos(token, gallery.id, newOrder.map((p) => p.id));
        } catch (err) {
          console.error('Failed to reorder photos:', err);
          // Revert on error
          setLocalPhotos(photos);
        }
      }
    }
  };

  const handleToggleFeatured = async (photo: Photo) => {
    if (!token) return;

    try {
      await updatePhoto(token, photo.id, { is_featured: !photo.is_featured });
      onPhotosChange();
    } catch (err) {
      console.error('Failed to update photo:', err);
    }
  };

  const handleSetCover = async (photoId: string) => {
    if (!token) return;

    try {
      await setCoverImage(token, gallery.id, photoId);
      onPhotosChange();
    } catch (err) {
      console.error('Failed to set cover:', err);
    }
  };

  const handleDelete = async (photoId: string) => {
    if (!token) return;

    try {
      await deletePhoto(token, photoId);
      setDeleteConfirm(null);
      onPhotosChange();
    } catch (err) {
      console.error('Failed to delete photo:', err);
    }
  };

  if (photos.length === 0) {
    return (
      <div className={styles.empty}>
        No photos yet. Upload some photos above!
      </div>
    );
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={localPhotos.map((p) => p.id)}
          strategy={rectSortingStrategy}
        >
          <div className={styles.grid}>
            {localPhotos.map((photo) => (
              <SortablePhotoCard
                key={photo.id}
                photo={photo}
                gallery={gallery}
                onToggleFeatured={handleToggleFeatured}
                onSetCover={handleSetCover}
                onDelete={(id) => setDeleteConfirm(id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h2 className={styles.modalTitle}>Delete Photo?</h2>
            <p className={styles.confirmText}>
              This will permanently delete this photo. This action cannot be undone.
            </p>
            <div className={styles.confirmActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                className={styles.deleteBtn}
                onClick={() => handleDelete(deleteConfirm)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
