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
  isSelected: boolean;
  onToggleSelect: (photoId: string) => void;
  onToggleFeatured: (photo: Photo) => void;
  onSetCover: (photoId: string) => void;
  onDelete: (photoId: string) => void;
}

function SortablePhotoCard({
  photo,
  gallery,
  isSelected,
  onToggleSelect,
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
      className={`${styles.card} ${isDragging ? styles.dragging : ''} ${isSelected ? styles.selected : ''}`}
    >
      <div className={styles.imageWrapper}>
        <div
          className={styles.dragArea}
          {...attributes}
          {...listeners}
        >
          <img
            src={photo.thumbnailUrl}
            alt={photo.original_filename}
            className={styles.image}
          />
          <div className={styles.dragHint}>Drag to reorder</div>
        </div>
        <label className={styles.checkbox} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(photo.id)}
          />
        </label>
        {gallery.cover_image_id === photo.id && (
          <span className={styles.coverBadge}>Cover</span>
        )}
        {photo.is_featured && (
          <span className={styles.featuredBadge}>Featured</span>
        )}
      </div>
      <div className={styles.info}>
        <div className={styles.filename}>{photo.original_filename}</div>
        <div className={styles.meta}>
          {photo.width}x{photo.height} &bull;{' '}
          {(photo.file_size / 1024).toFixed(0)}KB
        </div>
      </div>
      <div className={styles.actions}>
        {gallery.is_public && (
          <button
            className={`${styles.actionBtn} ${
              photo.is_featured ? styles.active : ''
            }`}
            onClick={() => onToggleFeatured(photo)}
            title={photo.is_featured ? 'Remove from featured' : 'Add to featured'}
          >
            {photo.is_featured ? 'Unfeature' : 'Feature'}
          </button>
        )}
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
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [localPhotos, setLocalPhotos] = useState<Photo[]>(photos);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Update local photos when props change
  if (photos !== localPhotos && photos.length !== localPhotos.length) {
    setLocalPhotos(photos);
    // Clear selection when photos change
    setSelectedIds(new Set());
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

  const handleToggleSelect = (photoId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === localPhotos.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(localPhotos.map((p) => p.id)));
    }
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

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

  // Bulk actions
  const handleBulkDelete = async () => {
    if (!token || selectedIds.size === 0) return;

    setBulkActionLoading(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => deletePhoto(token, id))
      );
      setSelectedIds(new Set());
      setBulkDeleteConfirm(false);
      onPhotosChange();
    } catch (err) {
      console.error('Failed to delete photos:', err);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkFeature = async (featured: boolean) => {
    if (!token || selectedIds.size === 0) return;

    setBulkActionLoading(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          updatePhoto(token, id, { is_featured: featured })
        )
      );
      setSelectedIds(new Set());
      onPhotosChange();
    } catch (err) {
      console.error('Failed to update photos:', err);
    } finally {
      setBulkActionLoading(false);
    }
  };

  if (photos.length === 0) {
    return (
      <div className={styles.empty}>
        No photos yet. Upload some photos above!
      </div>
    );
  }

  const allSelected = selectedIds.size === localPhotos.length;
  const someSelected = selectedIds.size > 0;

  return (
    <>
      {/* Bulk Action Toolbar */}
      <div className={styles.toolbar}>
        <label className={styles.selectAllLabel}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected && !allSelected;
            }}
            onChange={handleSelectAll}
          />
          {allSelected ? 'Deselect All' : 'Select All'}
        </label>

        {someSelected && (
          <div className={styles.bulkActions}>
            <span className={styles.selectedCount}>
              {selectedIds.size} selected
            </span>
            {gallery.is_public && (
              <>
                <button
                  className={styles.bulkBtn}
                  onClick={() => handleBulkFeature(true)}
                  disabled={bulkActionLoading}
                >
                  Feature
                </button>
                <button
                  className={styles.bulkBtn}
                  onClick={() => handleBulkFeature(false)}
                  disabled={bulkActionLoading}
                >
                  Unfeature
                </button>
              </>
            )}
            <button
              className={`${styles.bulkBtn} ${styles.danger}`}
              onClick={() => setBulkDeleteConfirm(true)}
              disabled={bulkActionLoading}
            >
              Delete
            </button>
            <button
              className={styles.bulkBtnCancel}
              onClick={handleClearSelection}
              disabled={bulkActionLoading}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

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
                isSelected={selectedIds.has(photo.id)}
                onToggleSelect={handleToggleSelect}
                onToggleFeatured={handleToggleFeatured}
                onSetCover={handleSetCover}
                onDelete={(id) => setDeleteConfirm(id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Single Delete Confirmation Modal */}
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

      {/* Bulk Delete Confirmation Modal */}
      {bulkDeleteConfirm && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h2 className={styles.modalTitle}>Delete {selectedIds.size} Photos?</h2>
            <p className={styles.confirmText}>
              This will permanently delete {selectedIds.size} photo{selectedIds.size > 1 ? 's' : ''}.
              This action cannot be undone.
            </p>
            <div className={styles.confirmActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => setBulkDeleteConfirm(false)}
                disabled={bulkActionLoading}
              >
                Cancel
              </button>
              <button
                className={styles.deleteBtn}
                onClick={handleBulkDelete}
                disabled={bulkActionLoading}
              >
                {bulkActionLoading ? 'Deleting...' : `Delete ${selectedIds.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
