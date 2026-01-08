import { useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { updatePhoto, deletePhoto, setCoverImage } from '../../../api/client';
import type { Photo, Gallery } from '../../../types';
import styles from './PhotoManager.module.css';

interface PhotoManagerProps {
  photos: Photo[];
  gallery: Gallery;
  onPhotosChange: () => void;
}

export default function PhotoManager({
  photos,
  gallery,
  onPhotosChange,
}: PhotoManagerProps) {
  const { token } = useAuth();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

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
      <div className={styles.grid}>
        {photos.map((photo) => (
          <div key={photo.id} className={styles.card}>
            <div className={styles.imageWrapper}>
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
                onClick={() => handleToggleFeatured(photo)}
                title={photo.is_featured ? 'Remove from featured' : 'Add to featured'}
              >
                {photo.is_featured ? 'Unfeature' : 'Feature'}
              </button>
              <button
                className={styles.actionBtn}
                onClick={() => handleSetCover(photo.id)}
                disabled={gallery.cover_image_id === photo.id}
              >
                Set Cover
              </button>
              <button
                className={`${styles.actionBtn} ${styles.danger}`}
                onClick={() => setDeleteConfirm(photo.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

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
