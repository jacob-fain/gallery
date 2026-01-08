import { useState, useEffect, type FormEvent } from 'react';
import type { Gallery, CreateGalleryInput, UpdateGalleryInput } from '../../../types';
import styles from './GalleryForm.module.css';

interface GalleryFormProps {
  gallery?: Gallery;
  onSubmit: (data: CreateGalleryInput | UpdateGalleryInput) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function GalleryForm({
  gallery,
  onSubmit,
  onCancel,
  isLoading = false,
}: GalleryFormProps) {
  const [title, setTitle] = useState(gallery?.title || '');
  const [slug, setSlug] = useState(gallery?.slug || '');
  const [description, setDescription] = useState(gallery?.description || '');
  const [isPublic, setIsPublic] = useState(gallery?.is_public ?? true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [autoSlug, setAutoSlug] = useState(!gallery);
  const [error, setError] = useState('');

  useEffect(() => {
    if (autoSlug && !gallery) {
      setSlug(slugify(title));
    }
  }, [title, autoSlug, gallery]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    if (!slug.trim()) {
      setError('Slug is required');
      return;
    }

    // For private galleries, validate password
    if (!isPublic) {
      // New gallery must have a password
      if (!gallery && !password.trim()) {
        setError('Password is required for private galleries');
        return;
      }

      // If password is being set, confirm must match
      if (password && password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    try {
      if (gallery) {
        await onSubmit({
          title,
          slug,
          description: description || null,
          is_public: isPublic,
          password: password || null,
        });
      } else {
        await onSubmit({
          title,
          slug,
          description: description || undefined,
          is_public: isPublic,
          password: password || undefined,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save gallery');
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.field}>
        <label htmlFor="title">Title</label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isLoading}
          required
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="slug">
          Slug
          {!gallery && (
            <button
              type="button"
              className={styles.autoBtn}
              onClick={() => setAutoSlug(!autoSlug)}
            >
              {autoSlug ? 'Manual' : 'Auto'}
            </button>
          )}
        </label>
        <input
          id="slug"
          type="text"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setAutoSlug(false);
          }}
          disabled={isLoading}
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          title="Lowercase letters, numbers, and hyphens only"
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isLoading}
          rows={3}
        />
      </div>

      <div className={styles.field}>
        <label>Visibility</label>
        <div className={styles.toggle}>
          <button
            type="button"
            className={`${styles.toggleBtn} ${isPublic ? styles.active : ''}`}
            onClick={() => setIsPublic(true)}
            disabled={isLoading}
          >
            Public
          </button>
          <button
            type="button"
            className={`${styles.toggleBtn} ${!isPublic ? styles.active : ''}`}
            onClick={() => setIsPublic(false)}
            disabled={isLoading}
          >
            Private
          </button>
        </div>
      </div>

      {!isPublic && (
        <>
          <div className={styles.field}>
            <label htmlFor="password">
              Password {gallery && '(leave blank to keep current)'}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              placeholder={gallery ? '••••••••' : 'Enter password'}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
              placeholder={gallery ? '••••••••' : 'Confirm password'}
            />
          </div>
        </>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={onCancel}
          disabled={isLoading}
        >
          Cancel
        </button>
        <button type="submit" className={styles.submitBtn} disabled={isLoading}>
          {isLoading ? 'Saving...' : gallery ? 'Update' : 'Create'}
        </button>
      </div>
    </form>
  );
}
