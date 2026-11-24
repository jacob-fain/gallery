import { useState, useEffect } from 'react';
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
import { useAuth } from '../../../contexts/auth';
import { deletePhoto, setCoverImage, reorderPhotos, movePhotos, getAllGalleries, updatePhoto } from '../../../api/client';
import type { Photo, Gallery } from '../../../types';
import { describeFailures, isPhotoGone, settleBulk } from '../../../utils/bulkResults';
import { photoAlt } from '../../../utils/photoAlt';
import styles from './PhotoManager.module.css';

// Select value for the Unassigned target; gallery ids are UUIDs, so it cannot collide.
const UNASSIGNED_TARGET = 'unassigned';

interface PhotoManagerProps {
  photos: Photo[];
  // null renders gallery-agnostic mode (unassigned photos): no cover, reorder, or shuffle
  gallery: Gallery | null;
  onPhotosChange: () => void;
}

interface SortablePhotoCardProps {
  photo: Photo;
  alt: string;
  isCover: boolean;
  isSelected: boolean;
  isDeleting: boolean;
  coverSelectMode: boolean;
  sortable: boolean;
  onToggleSelect: (photoId: string) => void;
  onCoverClick: (photoId: string) => void;
  onDelete: (photoId: string) => void;
  onToggleHidden: (photoId: string) => void;
}

function SortablePhotoCard({
  photo,
  alt,
  isCover,
  isSelected,
  isDeleting,
  coverSelectMode,
  sortable,
  onToggleSelect,
  onCoverClick,
  onDelete,
  onToggleHidden,
}: SortablePhotoCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: photo.id, disabled: !sortable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : isDeleting ? 0.3 : photo.is_hidden ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.card} ${isDragging ? styles.dragging : ''} ${isSelected ? styles.selected : ''} ${isDeleting ? styles.deleting : ''} ${photo.is_hidden ? styles.hidden : ''}`}
    >
      <div className={styles.imageWrapper}>
        {coverSelectMode ? (
          // In cover select mode, make the whole image clickable
          <div
            className={styles.coverSelectArea}
            onClick={() => onCoverClick(photo.id)}
          >
            <img
              src={photo.thumbnailUrl}
              alt={alt}
              className={styles.image}
            />
            <div className={styles.coverSelectHint}>Click to set as cover</div>
          </div>
        ) : (
          // Normal mode with drag functionality
          <div
            className={styles.dragArea}
            {...attributes}
            {...listeners}
          >
            <img
              src={photo.thumbnailUrl}
              alt={alt}
              className={styles.image}
            />
            {sortable && <div className={styles.dragHint}>Drag to reorder</div>}
          </div>
        )}
        {!coverSelectMode && (
          <label className={styles.checkbox} onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(photo.id)}
            />
          </label>
        )}
        {isCover && (
          <span className={styles.coverBadge}>Cover</span>
        )}
        {photo.is_hidden && (
          <span className={styles.hiddenBadge}>Hidden</span>
        )}
      </div>
      <div className={styles.cardFooter}>
        <div className={styles.filename}>{photo.original_filename}</div>
        <div className={styles.cardActions}>
          <button
            className={`${styles.hideIconBtn} ${photo.is_hidden ? styles.isHidden : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleHidden(photo.id);
            }}
            title={photo.is_hidden ? 'Show photo' : 'Hide photo'}
          >
            {photo.is_hidden ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
          <button
            className={`${styles.deleteIconBtn} ${isDeleting ? styles.loading : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(photo.id);
            }}
            title="Delete photo"
            disabled={isDeleting}
          >
            {isDeleting ? (
              <span className={styles.spinner} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" />
              </svg>
            )}
          </button>
        </div>
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
  // Shown above the grid when an action fails; actions used to fail silently.
  const [actionError, setActionError] = useState<string | null>(null);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [coverSelectMode, setCoverSelectMode] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [optimisticCoverId, setOptimisticCoverId] = useState<string | null>(null);
  const [shuffleConfirm, setShuffleConfirm] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [availableGalleries, setAvailableGalleries] = useState<Gallery[]>([]);
  const [selectedTargetGallery, setSelectedTargetGallery] = useState<string>('');
  const [moving, setMoving] = useState(false);

  // Sync local photos when props change (after API updates)
  useEffect(() => {
    setLocalPhotos(photos);
    setOptimisticCoverId(null); // Clear optimistic state when real data arrives
  }, [photos]);

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
      if (token && gallery) {
        try {
          await reorderPhotos(token, gallery.id, newOrder.map((p) => p.id));
        } catch (err) {
          setActionError(err instanceof Error ? err.message : 'Failed to save the new order');
          // Revert on error
          setLocalPhotos(photos);
        }
      }
    }
  };

  const handleSetCover = async (photoId: string) => {
    if (!token || !gallery) return;

    // Optimistic UI - show cover immediately
    setOptimisticCoverId(photoId);
    setCoverSelectMode(false);

    try {
      await setCoverImage(token, gallery.id, photoId);
      onPhotosChange();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to set the cover');
      setOptimisticCoverId(null);
    }
  };

  const handleDelete = async (photoId: string) => {
    if (!token) return;

    // Add to deleting set for immediate visual feedback
    setDeletingIds((prev) => new Set(prev).add(photoId));

    setActionError(null);
    try {
      await deletePhoto(token, photoId).catch((err) => {
        // Already gone counts as deleted.
        if (!isPhotoGone(err)) throw err;
      });
      setDeleteConfirm(null);
      setLocalPhotos((prev) => prev.filter((p) => p.id !== photoId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
      onPhotosChange();
    } catch (err) {
      setDeleteConfirm(null);
      setActionError(err instanceof Error ? err.message : 'Failed to delete photo');
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
    }
  };

  const handleToggleHidden = async (photoId: string) => {
    if (!token) return;

    const photo = localPhotos.find((p) => p.id === photoId);
    if (!photo) return;

    // Optimistic UI update
    setLocalPhotos((prev) =>
      prev.map((p) =>
        p.id === photoId ? { ...p, is_hidden: !p.is_hidden } : p
      )
    );

    try {
      await updatePhoto(token, photoId, { is_hidden: !photo.is_hidden });
      onPhotosChange();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to change visibility');
      setLocalPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId ? { ...p, is_hidden: photo.is_hidden } : p
        )
      );
    }
  };

  // Shuffle photos randomly
  const handleShuffle = async () => {
    if (!token || !gallery) return;

    setShuffling(true);

    // Fisher-Yates shuffle
    const shuffled = [...localPhotos];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Optimistic UI - show shuffled order immediately
    setLocalPhotos(shuffled);
    setShuffleConfirm(false);

    try {
      await reorderPhotos(token, gallery.id, shuffled.map((p) => p.id));
      onPhotosChange();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to shuffle');
      // Revert on error
      setLocalPhotos(photos);
    } finally {
      setShuffling(false);
    }
  };

  // Bulk actions
  const handleBulkDelete = async () => {
    if (!token || selectedIds.size === 0) return;

    setBulkActionLoading(true);
    // Mark all selected as deleting
    setDeletingIds(new Set(selectedIds));

    setActionError(null);
    const ids = Array.from(selectedIds);
    try {
      // Every request settles, so one failure cannot hide which photos were
      // deleted: those leave the grid and the selection, failures stay.
      const results = await Promise.allSettled(ids.map((id) => deletePhoto(token, id)));
      const outcome = settleBulk(ids, results, isPhotoGone);
      const done = new Set(outcome.done);
      setLocalPhotos((prev) => prev.filter((p) => !done.has(p.id)));
      setSelectedIds(new Set(outcome.failed.map((f) => f.id)));
      setBulkDeleteConfirm(false);
      setActionError(describeFailures('Deleted', 'deleted', outcome));
      onPhotosChange();
    } finally {
      setBulkActionLoading(false);
      setDeletingIds(new Set());
    }
  };

  // Open move modal and fetch galleries
  const handleOpenMoveModal = async () => {
    if (!token) return;
    try {
      const galleries = await getAllGalleries(token);
      // Filter out current gallery
      setAvailableGalleries(galleries.filter((g) => g.id !== gallery?.id));
      setSelectedTargetGallery('');
      setMoveModalOpen(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to load galleries');
    }
  };

  // Move selected photos
  const handleMove = async () => {
    if (!token || selectedIds.size === 0 || !selectedTargetGallery) return;

    setMoving(true);
    try {
      await movePhotos(
        token,
        Array.from(selectedIds),
        selectedTargetGallery === UNASSIGNED_TARGET ? null : selectedTargetGallery
      );
      setSelectedIds(new Set());
      setMoveModalOpen(false);
      onPhotosChange();
    } catch (err) {
      setMoveModalOpen(false);
      setActionError(err instanceof Error ? err.message : 'Failed to move photos');
      onPhotosChange();
    } finally {
      setMoving(false);
    }
  };

  // Show or hide the selected photos. Only photos not already in that state
  // are sent, so a mixed selection can be published without deselecting the
  // public ones first.
  const handleBulkSetHidden = async (hide: boolean) => {
    if (!token || selectedIds.size === 0) return;
    const ids = localPhotos
      .filter((p) => selectedIds.has(p.id) && p.is_hidden !== hide)
      .map((p) => p.id);
    if (ids.length === 0) return;
    const changing = new Set(ids);

    setBulkActionLoading(true);
    setLocalPhotos((prev) =>
      prev.map((p) => (changing.has(p.id) ? { ...p, is_hidden: hide } : p))
    );

    setActionError(null);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => updatePhoto(token, id, { is_hidden: hide }))
      );
      const outcome = settleBulk(ids, results);
      // Put back the ones that did not change, keep the rest.
      const failed = new Set(outcome.failed.map((f) => f.id));
      setLocalPhotos((prev) =>
        prev.map((p) => (failed.has(p.id) ? { ...p, is_hidden: !hide } : p))
      );
      setActionError(
        hide
          ? describeFailures('Hid', 'hidden', outcome)
          : describeFailures('Showed', 'shown', outcome)
      );
      onPhotosChange();
    } finally {
      setBulkActionLoading(false);
    }
  };

  const selectedHidden = localPhotos.some((p) => selectedIds.has(p.id) && p.is_hidden);
  const selectedVisible = localPhotos.some((p) => selectedIds.has(p.id) && !p.is_hidden);

  if (photos.length === 0) {
    return (
      <div className={styles.empty}>
        No photos yet. Upload some photos above!
      </div>
    );
  }

  const allSelected = selectedIds.size === localPhotos.length;
  const someSelected = selectedIds.size > 0;
  const effectiveCoverId = optimisticCoverId || gallery?.cover_image_id;
  const currentCover = localPhotos.find((p) => p.id === effectiveCoverId);

  return (
    <>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {gallery && (
            <>
              <button
                className={`${styles.setCoverBtn} ${coverSelectMode ? styles.active : ''}`}
                onClick={() => setCoverSelectMode(!coverSelectMode)}
              >
                {coverSelectMode ? 'Cancel' : 'Set Cover Photo'}
              </button>
              <button
                className={styles.shuffleBtn}
                onClick={() => setShuffleConfirm(true)}
                disabled={shuffling || localPhotos.length < 2}
              >
                {shuffling ? 'Shuffling...' : 'Shuffle'}
              </button>
            </>
          )}
          {currentCover && !coverSelectMode && (
            <span className={styles.currentCover}>
              Cover: {currentCover.original_filename}
            </span>
          )}
          {coverSelectMode && (
            <span className={styles.coverHint}>Click a photo to set as cover</span>
          )}
        </div>

        <div className={styles.toolbarRight}>
          {!coverSelectMode && (
            <>
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
                  <button
                    className={styles.bulkBtn}
                    onClick={() => handleBulkSetHidden(false)}
                    disabled={bulkActionLoading || !selectedHidden}
                  >
                    Show
                  </button>
                  <button
                    className={styles.bulkBtn}
                    onClick={() => handleBulkSetHidden(true)}
                    disabled={bulkActionLoading || !selectedVisible}
                  >
                    Hide
                  </button>
                  <button
                    className={styles.bulkBtn}
                    onClick={handleOpenMoveModal}
                    disabled={bulkActionLoading}
                  >
                    Move
                  </button>
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
            </>
          )}
        </div>
      </div>

      {actionError && (
        <div className={styles.actionError} role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={localPhotos.map((p) => p.id)}
          strategy={rectSortingStrategy}
        >
          <div className={`${styles.grid} ${coverSelectMode ? styles.coverSelectMode : ''}`}>
            {localPhotos.map((photo, index) => (
              <SortablePhotoCard
                key={photo.id}
                photo={photo}
                alt={photoAlt(index, localPhotos.length, gallery?.title)}
                isCover={effectiveCoverId === photo.id}
                isSelected={selectedIds.has(photo.id)}
                isDeleting={deletingIds.has(photo.id)}
                coverSelectMode={coverSelectMode}
                sortable={!!gallery}
                onToggleSelect={handleToggleSelect}
                onCoverClick={handleSetCover}
                onDelete={(id) => setDeleteConfirm(id)}
                onToggleHidden={handleToggleHidden}
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

      {/* Shuffle Confirmation Modal */}
      {shuffleConfirm && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h2 className={styles.modalTitle}>Shuffle Photos?</h2>
            <p className={styles.confirmText}>
              This will randomly reorder all {localPhotos.length} photos in this gallery.
            </p>
            <div className={styles.confirmActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => setShuffleConfirm(false)}
              >
                Cancel
              </button>
              <button
                className={styles.shuffleConfirmBtn}
                onClick={handleShuffle}
              >
                Shuffle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move Photos Modal */}
      {moveModalOpen && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h2 className={styles.modalTitle}>Move {selectedIds.size} Photo{selectedIds.size > 1 ? 's' : ''}</h2>
            <p className={styles.confirmText}>
              Select a gallery to move the selected photos to:
            </p>
            {availableGalleries.length === 0 && !gallery ? (
              <p className={styles.noGalleries}>No other galleries available.</p>
            ) : (
              <select
                className={styles.gallerySelect}
                value={selectedTargetGallery}
                onChange={(e) => setSelectedTargetGallery(e.target.value)}
              >
                <option value="">Select a gallery...</option>
                {gallery && <option value={UNASSIGNED_TARGET}>Unassigned</option>}
                {availableGalleries.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            )}
            <div className={styles.confirmActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => setMoveModalOpen(false)}
                disabled={moving}
              >
                Cancel
              </button>
              <button
                className={styles.moveBtn}
                onClick={handleMove}
                disabled={moving || !selectedTargetGallery}
              >
                {moving ? 'Moving...' : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
