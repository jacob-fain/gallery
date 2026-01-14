import { useState, useRef, useEffect, useCallback, memo, type DragEvent, type ChangeEvent } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { uploadPhoto } from '../../../api/client';
import type { Photo } from '../../../types';
import styles from './PhotoUpload.module.css';

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'processing' | 'complete' | 'error';
  error?: string;
}

interface PhotoUploadProps {
  galleryId: string;
  onUploadComplete: (photo: Photo) => void;
}

interface UploadItemProps {
  item: UploadingFile;
  onDismiss: (id: string) => void;
}

const UploadItem = memo(function UploadItem({ item, onDismiss }: UploadItemProps) {
  const getStatusText = () => {
    switch (item.status) {
      case 'pending': return 'Waiting...';
      case 'uploading': return `${item.progress}%`;
      case 'processing': return 'Processing...';
      case 'complete': return '✓ Done';
      default: return '';
    }
  };

  return (
    <div className={`${styles.uploadItem} ${styles[item.status]}`}>
      <span className={styles.filename}>{item.file.name}</span>
      {item.error ? (
        <>
          <span className={styles.error}>{item.error}</span>
          <button
            className={styles.dismissBtn}
            onClick={() => onDismiss(item.id)}
          >
            Dismiss
          </button>
        </>
      ) : (
        <div className={styles.progressWrapper}>
          <div className={styles.progressBar}>
            <div
              className={`${styles.progressFill} ${item.status === 'processing' ? styles.processing : ''}`}
              style={{
                width:
                  item.status === 'pending'
                    ? '0%'
                    : item.status === 'uploading'
                    ? `${item.progress}%`
                    : '100%',
              }}
            />
          </div>
          <span className={styles.progressText}>{getStatusText()}</span>
        </div>
      )}
    </div>
  );
});

export default function PhotoUpload({ galleryId, onUploadComplete }: PhotoUploadProps) {
  const { token } = useAuth();
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Warn user before leaving page with active uploads
  useEffect(() => {
    const hasActiveUploads = uploading.some(
      (u) => u.status === 'uploading' || u.status === 'pending' || u.status === 'processing'
    );

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasActiveUploads) {
        e.preventDefault();
        e.returnValue = 'You have uploads in progress. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    if (hasActiveUploads) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [uploading]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    if (!token) return;

    const fileArray = Array.from(files);
    const newUploading: UploadingFile[] = fileArray.map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      progress: 0,
      status: 'pending',
    }));
    setUploading((prev) => [...prev, ...newUploading]);

    for (const item of newUploading) {
      // Mark as uploading
      setUploading((prev) =>
        prev.map((u) =>
          u.id === item.id ? { ...u, status: 'uploading' } : u
        )
      );

      try {
        const photo = await uploadPhoto(token, galleryId, item.file, (progress) => {
          setUploading((prev) =>
            prev.map((u) => {
              if (u.id !== item.id) return u;
              // When upload hits 100%, switch to processing status
              if (progress === 100) {
                return { ...u, progress: 100, status: 'processing' };
              }
              return { ...u, progress };
            })
          );
        });
        onUploadComplete(photo);
        // Mark as complete
        setUploading((prev) =>
          prev.map((u) =>
            u.id === item.id ? { ...u, status: 'complete', progress: 100 } : u
          )
        );
        // Remove after delay so user sees the success state
        setTimeout(() => {
          setUploading((prev) => prev.filter((u) => u.id !== item.id));
        }, 1500);
      } catch (err) {
        setUploading((prev) =>
          prev.map((u) =>
            u.id === item.id
              ? { ...u, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' }
              : u
          )
        );
      }
    }
  }, [token, galleryId, onUploadComplete]);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = '';
    }
  };

  const dismissError = useCallback((id: string) => {
    setUploading((prev) => prev.filter((u) => u.id !== id));
  }, []);

  return (
    <div className={styles.container}>
      <div
        className={`${styles.dropzone} ${isDragging ? styles.dragging : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleChange}
          className={styles.input}
        />
        <div className={styles.dropzoneText}>
          <span className={styles.icon}>+</span>
          <span>Drop photos here or click to upload</span>
          <span className={styles.hint}>Supports JPEG, PNG, WebP, TIFF, HEIF</span>
        </div>
      </div>

      {uploading.length > 0 && (
        <div className={styles.uploads}>
          {uploading.map((item) => (
            <UploadItem key={item.id} item={item} onDismiss={dismissError} />
          ))}
        </div>
      )}
    </div>
  );
}
