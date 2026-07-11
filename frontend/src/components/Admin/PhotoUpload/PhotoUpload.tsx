import { useState, useRef, useEffect, useCallback, memo, type DragEvent, type ChangeEvent } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { uploadPhoto, checkDuplicates, type DuplicateInfo } from '../../../api/client';
import type { Photo } from '../../../types';
import styles from './PhotoUpload.module.css';

// Matches the server-side multer limit
const MAX_FILE_SIZE = 50 * 1024 * 1024;
// Files are hashed and duplicate-checked in batches so uploads can start
// while later files are still being hashed
const CHECK_BATCH_SIZE = 20;
// Parallel uploads
const UPLOAD_CONCURRENCY = 3;

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: 'checking' | 'pending' | 'uploading' | 'processing' | 'complete' | 'error' | 'duplicate' | 'new';
  error?: string;
  note?: string;
  retryable?: boolean;
}

interface BatchStats {
  total: number;
  uploaded: number;
  skipped: number;
  fresh: number;
  failed: number;
}

const EMPTY_STATS: BatchStats = { total: 0, uploaded: 0, skipped: 0, fresh: 0, failed: 0 };

interface PhotoUploadProps {
  galleryId: string | null;
  onUploadComplete: (photo: Photo) => void;
}

interface UploadItemProps {
  item: UploadingFile;
  onDismiss: (id: string) => void;
  onRetry: (id: string) => void;
}

// SHA-256 of a file's bytes - matches the content_hash stored at upload
// time because originals are preserved exactly as uploaded
async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const UploadItem = memo(function UploadItem({ item, onDismiss, onRetry }: UploadItemProps) {
  const getStatusText = () => {
    switch (item.status) {
      case 'checking': return 'Checking...';
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

export default function PhotoUpload({ galleryId, onUploadComplete }: PhotoUploadProps) {
  const { token } = useAuth();
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [stats, setStats] = useState<BatchStats>(EMPTY_STATS);
  const [isDragging, setIsDragging] = useState(false);
  const [checkOnly, setCheckOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Mirror of the upload list for retry lookups outside render
  const itemsRef = useRef<UploadingFile[]>([]);
  useEffect(() => {
    itemsRef.current = uploading;
  }, [uploading]);

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

  const updateItem = useCallback((id: string, patch: Partial<UploadingFile>) => {
    setUploading((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }, []);

  const uploadOne = useCallback(async (item: UploadingFile) => {
    if (!token) return;

    updateItem(item.id, { status: 'uploading', progress: 0, error: undefined });

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
      setStats((s) => ({ ...s, uploaded: s.uploaded + 1 }));
      updateItem(item.id, { status: 'complete', progress: 100 });
      // Remove after delay so user sees the success state
      setTimeout(() => {
        setUploading((prev) => prev.filter((u) => u.id !== item.id));
      }, 1500);
    } catch (err) {
      setStats((s) => ({ ...s, failed: s.failed + 1 }));
      updateItem(item.id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed',
        retryable: true,
      });
    }
  }, [token, galleryId, onUploadComplete, updateItem]);

  const handleRetry = useCallback((id: string) => {
    const item = itemsRef.current.find((u) => u.id === id);
    if (!item) return;
    setStats((s) => ({ ...s, failed: Math.max(0, s.failed - 1) }));
    uploadOne(item);
  }, [uploadOne]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    if (!token) return;

    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    // Starting fresh (nothing in flight): clear finished rows and reset counters
    const processed = stats.uploaded + stats.skipped + stats.fresh + stats.failed;
    if (stats.total === 0 || processed >= stats.total) {
      setUploading((prev) =>
        prev.filter(
          (u) => u.status === 'checking' || u.status === 'pending' || u.status === 'uploading' || u.status === 'processing'
        )
      );
      setStats({ ...EMPTY_STATS, total: fileArray.length });
    } else {
      setStats((s) => ({ ...s, total: s.total + fileArray.length }));
    }

    // Client-side validation - matches server limits so bad files fail fast
    const newItems: UploadingFile[] = fileArray.map((file) => {
      const invalidReason = !file.type.startsWith('image/')
        ? 'Not an image file'
        : file.size > MAX_FILE_SIZE
        ? 'Larger than the 50MB upload limit'
        : null;
      return {
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        progress: 0,
        status: invalidReason ? ('error' as const) : ('checking' as const),
        error: invalidReason ?? undefined,
        retryable: false,
      };
    });
    setUploading((prev) => [...prev, ...newItems]);

    const invalidCount = newItems.filter((i) => i.status === 'error').length;
    if (invalidCount > 0) {
      setStats((s) => ({ ...s, failed: s.failed + invalidCount }));
    }
    const validItems = newItems.filter((i) => i.status === 'checking');

    // Producer hashes and duplicate-checks files in batches, feeding the
    // upload queue; workers upload concurrently while later batches are
    // still being hashed. If hashing or the check fails, files fall
    // through to upload - the server rejects duplicates as a safety net.
    const queue: UploadingFile[] = [];
    let producerDone = false;
    const seenHashes = new Set<string>();

    const producer = (async () => {
      for (let i = 0; i < validItems.length; i += CHECK_BATCH_SIZE) {
        const batch = validItems.slice(i, i + CHECK_BATCH_SIZE);

        const batchHashes = new Map<string, string>();
        for (const item of batch) {
          try {
            batchHashes.set(item.id, await hashFile(item.file));
          } catch {
            // Hashing unavailable - treat as new
          }
        }

        let existing: Record<string, DuplicateInfo> = {};
        try {
          const unchecked = [...new Set(batchHashes.values())].filter((h) => !seenHashes.has(h));
          if (unchecked.length > 0) {
            existing = await checkDuplicates(token, unchecked);
          }
        } catch {
          // Check failed - proceed with uploads
        }

        for (const item of batch) {
          const hash = batchHashes.get(item.id);
          const dup = hash ? existing[hash] : undefined;

          if (dup) {
            const where = dup.gallery_title
              ? ` in ${dup.gallery_title}`
              : dup.gallery_id === null
              ? ' (unassigned)'
              : '';
            setStats((s) => ({ ...s, skipped: s.skipped + 1 }));
            updateItem(item.id, {
              status: 'duplicate',
              note: `Already uploaded${where} as ${dup.original_filename}`,
            });
          } else if (hash && seenHashes.has(hash)) {
            setStats((s) => ({ ...s, skipped: s.skipped + 1 }));
            updateItem(item.id, {
              status: 'duplicate',
              note: 'Duplicate of another file in this batch',
            });
          } else if (checkOnly) {
            setStats((s) => ({ ...s, fresh: s.fresh + 1 }));
            updateItem(item.id, { status: 'new', note: 'Not uploaded yet' });
            if (hash) seenHashes.add(hash);
          } else {
            if (hash) seenHashes.add(hash);
            updateItem(item.id, { status: 'pending' });
            queue.push(item);
          }
        }
      }
      producerDone = true;
    })();

    if (checkOnly) {
      await producer;
      return;
    }

    const workers = Array.from({ length: UPLOAD_CONCURRENCY }, () =>
      (async () => {
        for (;;) {
          const item = queue.shift();
          if (!item) {
            if (producerDone) return;
            await new Promise((resolve) => setTimeout(resolve, 150));
            continue;
          }
          await uploadOne(item);
        }
      })()
    );

    await Promise.all([producer, ...workers]);
  }, [token, checkOnly, stats, uploadOne, updateItem]);

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

  const hasResults = uploading.some((u) => u.status === 'duplicate' || u.status === 'new');
  const processed = stats.uploaded + stats.skipped + stats.fresh + stats.failed;
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
              : 'JPEG, PNG, WebP, TIFF, HEIF up to 50MB. Already-uploaded photos are skipped.'}
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
        {hasResults && (
          <button
            className={styles.clearBtn}
            onClick={() =>
              setUploading((prev) =>
                prev.filter((u) => u.status !== 'duplicate' && u.status !== 'new')
              )
            }
          >
            Clear results
          </button>
        )}
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
