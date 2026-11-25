import { useState } from 'react';
import styles from './Review.module.css';

interface RejectedBarProps {
  count: number;
  // Resolves once the photos are deleted; rejects with what went wrong.
  onDeleteAll: () => Promise<void>;
}

const plural = (n: number) => `${n} rejected photo${n === 1 ? '' : 's'}`;

/**
 * Above the Rejected filter: what rejected means, and the one way photos are
 * deleted in review, all at once after a confirm.
 */
export default function RejectedBar({ count, onDeleteAll }: RejectedBarProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onDeleteAll();
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete the rejected photos');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className={styles.infoBar}>
        <span>
          Rejected photos are private and kept until you delete them. Open one to send it back to review.
        </span>
        {count > 0 && (
          <button
            type="button"
            className={styles.deleteAll}
            disabled={confirming}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Delete all rejected ({count})
          </button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {confirming && (
        <div role="alertdialog" aria-label="Delete rejected photos" className={styles.confirm}>
          <span>Delete {plural(count)} from the site and storage? This can&apos;t be undone.</span>
          <div className={styles.confirmButtons}>
            <button type="button" className={styles.confirmCancel} onClick={() => setConfirming(false)} disabled={deleting}>
              Cancel
            </button>
            <button type="button" className={styles.confirmDelete} onClick={remove} disabled={deleting}>
              {deleting ? 'Deleting...' : `Delete ${count}`}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
