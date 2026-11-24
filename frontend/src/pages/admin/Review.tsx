import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getAllPhotosAdmin,
  getAllGalleries,
  updatePhoto,
  deletePhoto,
} from '../../api/client';
import type { Photo, Gallery } from '../../types';
import styles from './Review.module.css';

export default function Review() {
  const { token } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      if (!token) return;
      try {
        const [photosData, galleriesData] = await Promise.all([
          getAllPhotosAdmin(token),
          getAllGalleries(token),
        ]);
        setPhotos(photosData);
        setGalleries(galleriesData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load photos');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const handleToggleHidden = async (photo: Photo) => {
    if (!token) return;
    // Optimistic toggle, revert on failure
    setPhotos((prev) =>
      prev.map((p) => (p.id === photo.id ? { ...p, is_hidden: !p.is_hidden } : p))
    );
    try {
      await updatePhoto(token, photo.id, { is_hidden: !photo.is_hidden });
    } catch (err) {
      console.error('Failed to toggle hidden:', err);
      setPhotos((prev) =>
        prev.map((p) => (p.id === photo.id ? { ...p, is_hidden: photo.is_hidden } : p))
      );
    }
  };

  const handleDelete = async (photoId: string) => {
    if (!token) return;
    setDeletingIds((prev) => new Set(prev).add(photoId));
    setDeleteConfirm(null);
    try {
      await deletePhoto(token, photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch (err) {
      console.error('Failed to delete photo:', err);
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  const filtered = photos.filter((p) =>
    filter === 'all' ? true : filter === 'unassigned' ? p.gallery_id === null : p.gallery_id === filter
  );
  const hiddenCount = filtered.filter((p) => p.is_hidden).length;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Review</h1>
          <p className={styles.subtitle}>
            {filtered.length} photo{filtered.length === 1 ? '' : 's'}
            {hiddenCount > 0 && ` · ${hiddenCount} hidden`} — scroll through and decide
            what stays on the site
          </p>
        </div>
        <select
          className={styles.filter}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All photos</option>
          <option value="unassigned">Unassigned</option>
          {galleries.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      </header>

      {filtered.length === 0 ? (
        <div className={styles.empty}>No photos here.</div>
      ) : (
        <div className={styles.list}>
          {filtered.map((photo) => {
            const isDeleting = deletingIds.has(photo.id);
            return (
              <article
                key={photo.id}
                className={`${styles.item} ${photo.is_hidden ? styles.hidden : ''} ${isDeleting ? styles.deleting : ''}`}
              >
                <div className={styles.imageWrapper}>
                  <img
                    src={photo.webUrl}
                    alt={photo.original_filename}
                    className={styles.image}
                    loading="lazy"
                  />
                  {photo.is_hidden && <span className={styles.hiddenBadge}>Hidden</span>}
                </div>
                <div className={styles.itemBar}>
                  <span className={styles.meta}>
                    {photo.original_filename}
                    <span className={styles.metaLocation}>
                      {photo.gallery_title || 'Unassigned'}
                    </span>
                  </span>
                  <div className={styles.actions}>
                    <button
                      className={styles.hideBtn}
                      onClick={() => handleToggleHidden(photo)}
                      disabled={isDeleting}
                    >
                      {photo.is_hidden ? 'Show' : 'Hide'}
                    </button>
                    {deleteConfirm === photo.id ? (
                      <>
                        <button
                          className={styles.deleteBtn}
                          onClick={() => handleDelete(photo.id)}
                        >
                          Confirm delete
                        </button>
                        <button
                          className={styles.cancelBtn}
                          onClick={() => setDeleteConfirm(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className={styles.deleteOutlineBtn}
                        onClick={() => setDeleteConfirm(photo.id)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
