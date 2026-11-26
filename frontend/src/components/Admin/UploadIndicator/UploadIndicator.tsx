import { Link } from 'react-router-dom';
import { useUploadQueue, useUploadSummary } from '../../../contexts/uploads';
import uploadStyles from '../PhotoUpload/PhotoUpload.module.css';
import { CONFIRMING, secondsLeft } from '../PhotoUpload/retryText';
import { useNow } from '../PhotoUpload/useNow';
import styles from './UploadIndicator.module.css';

/** Upload progress on every admin page, so leaving the upload page does not
 *  hide uploads that are still running, retrying, or failed. */
export default function UploadIndicator() {
  const queue = useUploadQueue();
  const summary = useUploadSummary();
  // Nothing is being sent: every running row waits on a retry or a check.
  const waiting = summary.active && summary.moving === 0;
  const now = useNow(waiting && summary.confirming === 0 && summary.nextRetryAt !== null);
  if (!summary.active && summary.failed === 0) return null;

  const percent = summary.total > 0 ? Math.round((summary.processed / summary.total) * 100) : 0;
  const label = !waiting
    ? `${summary.checkOnly ? 'Checking' : 'Uploading'} ${summary.processed}/${summary.total}`
    : summary.confirming > 0
    ? CONFIRMING
    : summary.nextRetryAt !== null
    ? `Retrying in ${secondsLeft(summary.nextRetryAt, summary.nextRetryDelayMs, now)}s`
    : 'Retrying...';
  // With uploads going to more than one place there is no single page to link.
  const to =
    summary.targetCount === 1
      ? summary.galleryId
        ? `/galleries/${summary.galleryId}/photos`
        : '/unassigned'
      : null;

  const details: string[] = [];
  // While waiting, the label already names the first of these.
  const named = !waiting ? null : summary.confirming > 0 ? 'confirming' : 'retrying';
  if (summary.confirming > 0 && named !== 'confirming') details.push(`${summary.confirming} confirming`);
  if (summary.retrying > 0 && named !== 'retrying') details.push(`${summary.retrying} retrying`);
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
