import { Link } from 'react-router-dom';
import { useUploadQueue, useUploadSummary } from '../../../contexts/uploads';
import uploadStyles from '../PhotoUpload/PhotoUpload.module.css';
import styles from './UploadIndicator.module.css';

/** Upload progress on every admin page, so leaving the upload page does not
 *  hide uploads that are still running, retrying, or failed. */
export default function UploadIndicator() {
  const queue = useUploadQueue();
  const summary = useUploadSummary();
  if (!summary.active && summary.failed === 0) return null;

  const percent = summary.total > 0 ? Math.round((summary.processed / summary.total) * 100) : 0;
  const label = `${summary.checkOnly ? 'Checking' : 'Uploading'} ${summary.processed}/${summary.total}`;
  // With uploads going to more than one place there is no single page to link.
  const to =
    summary.targetCount === 1
      ? summary.galleryId
        ? `/galleries/${summary.galleryId}/photos`
        : '/unassigned'
      : null;

  const details: string[] = [];
  if (summary.retrying > 0) details.push(`${summary.retrying} retrying`);
  if (summary.failed > 0) details.push(`${summary.failed} failed`);

  return (
    <div className={`${styles.indicator} ${summary.active ? '' : styles.failedOnly}`}>
      {summary.active && (
        <div className={styles.row}>
          <div
            className={uploadStyles.summaryBar}
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={summary.total}
            aria-valuenow={summary.processed}
          >
            <div className={uploadStyles.summaryFill} style={{ width: `${percent}%` }} />
          </div>
          {to ? (
            <Link to={to} className={`${uploadStyles.summaryText} ${styles.link}`}>
              {label}
            </Link>
          ) : (
            <span className={uploadStyles.summaryText}>{label}</span>
          )}
        </div>
      )}
      {details.length > 0 && (
        <div className={styles.row}>
          <span className={`${uploadStyles.summaryText} ${styles.details}`}>
            {summary.active ? details.join(' · ') : `${summary.failed} ${summary.failed === 1 ? 'upload' : 'uploads'} failed`}
          </span>
          {summary.failed > 0 && (
            <button className={uploadStyles.clearBtn} onClick={() => queue.retryAllFailed()}>
              Retry all failed
            </button>
          )}
        </div>
      )}
    </div>
  );
}
