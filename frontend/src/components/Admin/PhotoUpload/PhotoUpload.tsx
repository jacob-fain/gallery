import { useState, useRef, useEffect, useCallback, memo, type DragEvent, type ChangeEvent } from 'react';
import { useUploadQueue, useUploadTarget } from '../../../contexts/uploads';
import type { Photo } from '../../../types';
import { processedCount, type UploadItem as UploadingFile } from '../../../utils/uploadQueue';
import { retryText } from './retryText';
import { useNow } from './useNow';
import styles from './PhotoUpload.module.css';

interface PhotoUploadProps {
  galleryId: string | null;
  onUploadComplete: (photo: Photo) => void;
  /** A retry found photos already stored whose answers were lost, so there
   *  is no photo to add: the page reloads its list. */
  onUploadsRecovered?: () => void;
}

interface UploadItemProps {
  item: UploadingFile;
  onDismiss: (id: string) => void;
  onRetry: (id: string) => void;
}

const UploadItem = memo(function UploadItem({ item, onDismiss, onRetry }: UploadItemProps) {
  const now = useNow(item.status === 'retrying' && !item.confirming && item.retryAt !== undefined);
  const getStatusText = () => {
    switch (item.status) {
      case 'checking': return 'Checking...';
      case 'pending': return 'Waiting...';
      case 'uploading': return `${item.progress}%`;
      case 'processing': return 'Processing...';
      case 'complete': return item.note ?? '✓ Done';
      default: return '';
    }
  };

  return (
    <div className={`${styles.uploadItem} ${styles[item.status]}`}>
      <span className={styles.filename}>{item.file.name}</span>
      {item.error ? (
        <>
          <span className={styles.error}>{item.error}</span>
          {item.retryable && (
            <button
              className={styles.dismissBtn}
              onClick={() => onRetry(item.id)}
            >
              Retry
            </button>
          )}
          <button
            className={styles.dismissBtn}
            onClick={() => onDismiss(item.id)}
          >
            Dismiss
          </button>
        </>
      ) : item.status === 'retrying' ? (
        <span className={styles.retryNote} title={item.note}>
          {retryText(item, now)}
        </span>
      ) : item.status === 'duplicate' || item.status === 'new' ? (
        <>
          <span className={item.status === 'duplicate' ? styles.duplicateNote : styles.newNote}>
            {item.note}
          </span>
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
                  item.status === 'pending' || item.status === 'checking'
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

export default function PhotoUpload({ galleryId, onUploadComplete, onUploadsRecovered }: PhotoUploadProps) {
  const queue = useUploadQueue();
  const { items: uploading, stats } = useUploadTarget(galleryId);
  const [isDragging, setIsDragging] = useState(false);
  const [checkOnly, setCheckOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Uploads outlive this page, so only the ones finishing while it is open
  // reach its photo list; it reloads the rest when it mounts again.
  useEffect(
    () =>
      queue.onComplete((photo, target) => {
        if (target === galleryId) onUploadComplete(photo);
      }),
    [queue, galleryId, onUploadComplete]
  );

  useEffect(
    () =>
      queue.onRecovered((target) => {
        if (target === galleryId) onUploadsRecovered?.();
      }),
    [queue, galleryId, onUploadsRecovered]
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => queue.add(Array.from(files), { galleryId, checkOnly }),
    [queue, galleryId, checkOnly]
  );

  const handleRetry = useCallback((id: string) => queue.retry(id), [queue]);

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

  const dismissError = useCallback((id: string) => queue.dismiss(id), [queue]);

  const hasResults = uploading.some((u) => u.status === 'duplicate' || u.status === 'new');
  const failedCount = uploading.filter((u) => u.status === 'error' && u.retryable).length;
  const processed = processedCount(stats);
  const batchDone = stats.total > 0 && processed >= stats.total;

  const summaryParts: string[] = [];
  if (stats.uploaded > 0 || !checkOnly) summaryParts.push(`${stats.uploaded} uploaded`);
  if (stats.skipped > 0) summaryParts.push(`${stats.skipped} skipped`);
  if (stats.fresh > 0) summaryParts.push(`${stats.fresh} not uploaded yet`);
  if (stats.failed > 0) summaryParts.push(`${stats.failed} failed`);

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
          <span>{checkOnly ? 'Drop photos here to check if they are uploaded' : 'Drop photos here or click to upload'}</span>
          <span className={styles.hint}>
            {checkOnly
              ? 'Nothing will be uploaded'
              : 'JPEG, PNG, WebP, TIFF up to 50MB. Already-uploaded photos are skipped.'}
          </span>
        </div>
      </div>

      <div className={styles.optionsRow}>
        <label className={styles.checkOnlyLabel}>
          <input
            type="checkbox"
            checked={checkOnly}
            onChange={(e) => setCheckOnly(e.target.checked)}
          />
          Check only — don't upload
        </label>
        <div className={styles.optionsActions}>
          {failedCount > 0 && (
            <button className={styles.clearBtn} onClick={() => queue.retryAllFailed(galleryId)}>
              Retry all failed ({failedCount})
            </button>
          )}
          {hasResults && (
            <button
              className={styles.clearBtn}
              onClick={() => queue.clearResults(galleryId)}
            >
              Clear results
            </button>
          )}
        </div>
      </div>

      {stats.total > 0 && (
        <div className={styles.summary}>
          <div className={styles.summaryBar}>
            <div
              className={`${styles.summaryFill} ${batchDone ? styles.summaryDone : ''}`}
              style={{ width: `${Math.round((processed / stats.total) * 100)}%` }}
            />
          </div>
          <span className={styles.summaryText}>
            {batchDone ? 'Done' : `${processed}/${stats.total}`}
            {summaryParts.length > 0 && ` · ${summaryParts.join(' · ')}`}
          </span>
        </div>
      )}

      {uploading.length > 0 && (
        <div className={styles.uploads}>
          {uploading.map((item) => (
            <UploadItem key={item.id} item={item} onDismiss={dismissError} onRetry={handleRetry} />
          ))}
        </div>
      )}
    </div>
  );
}
