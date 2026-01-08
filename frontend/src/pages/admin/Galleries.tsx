import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../../contexts/AuthContext';
import {
  getAllGalleries,
  createGallery,
  updateGallery,
  deleteGallery,
  reorderGalleries,
} from '../../api/client';
import GalleryForm from '../../components/Admin/GalleryForm/GalleryForm';
import type { Gallery, CreateGalleryInput, UpdateGalleryInput } from '../../types';
import styles from './Galleries.module.css';

type ModalMode = 'closed' | 'create' | 'edit';

interface SortableRowProps {
  gallery: Gallery;
  copiedId: string | null;
  onCopyLink: (gallery: Gallery) => void;
  onEdit: (gallery: Gallery) => void;
  onDelete: (id: string) => void;
}

function SortableRow({ gallery, copiedId, onCopyLink, onEdit, onDelete }: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: gallery.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr ref={setNodeRef} style={style} className={isDragging ? styles.dragging : ''}>
      <td className={styles.dragHandle} {...attributes} {...listeners}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="2" />
          <circle cx="15" cy="6" r="2" />
          <circle cx="9" cy="12" r="2" />
          <circle cx="15" cy="12" r="2" />
          <circle cx="9" cy="18" r="2" />
          <circle cx="15" cy="18" r="2" />
        </svg>
      </td>
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
        <button
          className={styles.actionBtn}
          onClick={() => onCopyLink(gallery)}
        >
          {copiedId === gallery.id ? 'Copied!' : 'Copy Link'}
        </button>
        <Link
          to={`/galleries/${gallery.id}/photos`}
          className={styles.actionBtn}
        >
          Photos
        </Link>
        <button
          className={styles.actionBtn}
          onClick={() => onEdit(gallery)}
        >
          Edit
        </button>
        <button
          className={`${styles.actionBtn} ${styles.danger}`}
          onClick={() => onDelete(gallery.id)}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

export default function Galleries() {
  const { token } = useAuth();
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalMode, setModalMode] = useState<ModalMode>('closed');
  const [editingGallery, setEditingGallery] = useState<Gallery | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
      const oldIndex = galleries.findIndex((g) => g.id === active.id);
      const newIndex = galleries.findIndex((g) => g.id === over.id);

      const newOrder = arrayMove(galleries, oldIndex, newIndex);
      setGalleries(newOrder);

      // Save to backend
      if (token) {
        try {
          await reorderGalleries(token, newOrder.map((g) => g.id));
        } catch (err) {
          console.error('Failed to reorder galleries:', err);
          // Revert on error
          fetchGalleries();
        }
      }
    }
  };

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

  const handleCopyLink = async (gallery: Gallery) => {
    // Remove 'manage.' from origin to get public URL
    const baseUrl = window.location.origin.replace('manage.', '');
    const url = `${baseUrl}/g/${gallery.slug}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(gallery.id);
    setTimeout(() => setCopiedId(null), 2000);
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.dragHeader}></th>
                <th>Title</th>
                <th>Slug</th>
                <th>Visibility</th>
                <th>Views</th>
                <th>Actions</th>
              </tr>
            </thead>
            <SortableContext
              items={galleries.map((g) => g.id)}
              strategy={verticalListSortingStrategy}
            >
              <tbody>
                {galleries.map((gallery) => (
                  <SortableRow
                    key={gallery.id}
                    gallery={gallery}
                    copiedId={copiedId}
                    onCopyLink={handleCopyLink}
                    onEdit={openEdit}
                    onDelete={setDeleteConfirm}
                  />
                ))}
                {galleries.length === 0 && (
                  <tr>
                    <td colSpan={6} className={styles.empty}>
                      No galleries yet. Create your first one!
                    </td>
                  </tr>
                )}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
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
