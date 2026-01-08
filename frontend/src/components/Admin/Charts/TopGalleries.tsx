import { Link } from 'react-router-dom';
import styles from './Charts.module.css';

interface TopGalleriesProps {
  data: { id: string; title: string; slug: string; view_count: number }[];
}

export default function TopGalleries({ data }: TopGalleriesProps) {
  return (
    <div className={styles.leaderboard}>
      <h3 className={styles.leaderboardTitle}>Top Galleries</h3>
      {data.length === 0 ? (
        <div className={styles.emptyList}>No data yet</div>
      ) : (
        <ul className={styles.leaderboardList}>
          {data.map((gallery, index) => (
            <li key={gallery.id} className={styles.leaderboardItem}>
              <span className={styles.rank}>
                {index + 1}.
              </span>
              <div className={styles.itemInfo}>
                <Link
                  to={`/galleries/${gallery.id}/photos`}
                  className={styles.itemTitle}
                >
                  {gallery.title}
                </Link>
                <div className={styles.itemSubtitle}>/{gallery.slug}</div>
              </div>
              <div className={styles.itemStats}>
                <span className={styles.stat}>
                  <span className={styles.statValue}>{gallery.view_count.toLocaleString()}</span> views
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
