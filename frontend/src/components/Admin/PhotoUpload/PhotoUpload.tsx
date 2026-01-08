import { useState, useRef, type DragEvent, type ChangeEvent } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { uploadPhoto } from '../../../api/client';
import type { Photo } from '../../../types';
import styles from './PhotoUpload.module.css';

interface UploadingFile {
  file: File;
  progress: number;
  error?: string;
}

interface PhotoUploadProps {
  galleryId: string;
  onUploadComplete: (photo: Photo) => void;
}

export default function PhotoUpload({ galleryId, onUploadComplete }: PhotoUploadProps) {
  const { token } = useAuth();
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    if (!token) return;

    const fileArray = Array.from(files);
    const newUploading = fileArray.map((file) => ({ file, progress: 0 }));
    setUploading((prev) => [...prev, ...newUploading]);

    for (const item of newUploading) {
      try {
        const photo = await uploadPhoto(token, galleryId, item.file, (progress) => {
          setUploading((prev) =>
            prev.map((u) =>
              u.file === item.file ? { ...u, progress } : u
            )
          );
        });
        onUploadComplete(photo);
        setUploading((prev) => prev.filter((u) => u.file !== item.file));
      } catch (err) {
        setUploading((prev) =>
          prev.map((u) =>
            u.file === item.file
              ? { ...u, error: err instanceof Error ? err.message : 'Upload failed' }
              : u
          )
        );
      }
    }
  };

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

  const dismissError = (file: File) => {
    setUploading((prev) => prev.filter((u) => u.file !== file));
  };

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
          {uploading.map((item, index) => (
            <div key={index} className={styles.uploadItem}>
              <span className={styles.filename}>{item.file.name}</span>
              {item.error ? (
                <>
                  <span className={styles.error}>{item.error}</span>
                  <button
                    className={styles.dismissBtn}
                    onClick={() => dismissError(item.file)}
                  >
                    Dismiss
                  </button>
                </>
              ) : (
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
