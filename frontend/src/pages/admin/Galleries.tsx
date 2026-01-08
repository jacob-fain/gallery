import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getAllGalleries,
  createGallery,
  updateGallery,
  deleteGallery,
} from '../../api/client';
import GalleryForm from '../../components/Admin/GalleryForm/GalleryForm';
import type { Gallery, CreateGalleryInput, UpdateGalleryInput } from '../../types';
import styles from './Galleries.module.css';

type ModalMode = 'closed' | 'create' | 'edit';

export default function Galleries() {
  const { token } = useAuth();
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalMode, setModalMode] = useState<ModalMode>('closed');
  const [editingGallery, setEditingGallery] = useState<Gallery | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchGalleries = async () => {
    if (!token) return;

    try {
      const data = await getAllGalleries(token);
      setGalleries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load galleries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGalleries();
  }, [token]);

  const handleCreate = async (data: CreateGalleryInput | UpdateGalleryInput) => {
    if (!token) return;
    setFormLoading(true);

    try {
      await createGallery(token, data as CreateGalleryInput);
      setModalMode('closed');
      await fetchGalleries();
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdate = async (data: CreateGalleryInput | UpdateGalleryInput) => {
    if (!token || !editingGallery) return;
    setFormLoading(true);

    try {
      await updateGallery(token, editingGallery.id, data as UpdateGalleryInput);
      setModalMode('closed');
      setEditingGallery(null);
      await fetchGalleries();
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!token) return;

    try {
      await deleteGallery(token, id);
      setDeleteConfirm(null);
      await fetchGalleries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete gallery');
    }
  };

  const openEdit = (gallery: Gallery) => {
    setEditingGallery(gallery);
    setModalMode('edit');
  };

  const closeModal = () => {
    setModalMode('closed');
    setEditingGallery(null);
  };

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Galleries</h1>
        <button
          className={styles.createBtn}
          onClick={() => setModalMode('create')}
        >
          New Gallery
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Slug</th>
              <th>Visibility</th>
              <th>Views</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {galleries.map((gallery) => (
              <tr key={gallery.id}>
                <td>{gallery.title}</td>
                <td className={styles.slug}>/g/{gallery.slug}</td>
                <td>
                  <span
                    className={`${styles.badge} ${
                      gallery.is_public ? styles.public : styles.private
                    }`}
                  >
                    {gallery.is_public ? 'Public' : 'Private'}
                  </span>
                </td>
                <td>{gallery.view_count.toLocaleString()}</td>
                <td className={styles.actions}>
                  <Link
                    to={`/galleries/${gallery.id}/photos`}
                    className={styles.actionBtn}
                  >
                    Photos
                  </Link>
                  <button
                    className={styles.actionBtn}
                    onClick={() => openEdit(gallery)}
                  >
                    Edit
                  </button>
                  <button
                    className={`${styles.actionBtn} ${styles.danger}`}
                    onClick={() => setDeleteConfirm(gallery.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {galleries.length === 0 && (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  No galleries yet. Create your first one!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {modalMode !== 'closed' && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h2 className={styles.modalTitle}>
              {modalMode === 'create' ? 'New Gallery' : 'Edit Gallery'}
            </h2>
            <GalleryForm
              gallery={editingGallery || undefined}
              onSubmit={modalMode === 'create' ? handleCreate : handleUpdate}
              onCancel={closeModal}
              isLoading={formLoading}
            />
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h2 className={styles.modalTitle}>Delete Gallery?</h2>
            <p className={styles.confirmText}>
              This will permanently delete the gallery and all its photos. This
              action cannot be undone.
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
    </div>
  );
}
