import { Link } from 'react-router-dom';
import styles from './Charts.module.css';

interface TopPhotosProps {
  data: {
    id: string;
    filename: string;
    gallery_id: string | null;
    gallery_title: string;
    thumbnailUrl: string;
    view_count: number;
    download_count: number;
  }[];
}

export default function TopPhotos({ data }: TopPhotosProps) {
  return (
    <div className={styles.leaderboard}>
      <h3 className={styles.leaderboardTitle}>Top Photos</h3>
      {data.length === 0 ? (
        <div className={styles.emptyList}>No data yet</div>
      ) : (
        <ul className={styles.leaderboardList}>
          {data.map((photo, index) => (
            <li key={photo.id} className={styles.leaderboardItem}>
              <span className={styles.rank}>
                {index + 1}.
              </span>
              <Link
                to={photo.gallery_id ? `/galleries/${photo.gallery_id}/photos` : '/unassigned'}
                className={styles.photoThumbnail}
              >
                <img src={photo.thumbnailUrl} alt={`Top photo ${index + 1} in ${photo.gallery_title}`} />
              </Link>
              <div className={styles.itemInfo}>
                <div className={styles.itemTitle}>{photo.filename}</div>
                <div className={styles.itemSubtitle}>{photo.gallery_title}</div>
              </div>
              <div className={styles.itemStats}>
                <span className={styles.stat}>
                  <span className={styles.statValue}>{photo.view_count.toLocaleString()}</span> views
                </span>
                <span className={styles.stat}>
                  <span className={styles.statValue}>{photo.download_count.toLocaleString()}</span> downloads
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
