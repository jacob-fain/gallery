import { SkeletonBlock } from '../Skeleton/Skeleton';
import gridStyles from './PhotoGrid.module.css';
import styles from './PhotoGridSkeleton.module.css';

// Mixed landscape and portrait shapes, offset per column, so the
// placeholders read as a masonry of photos rather than a table.
const COLUMNS = [
  ['3 / 2', '2 / 3', '3 / 2', '4 / 5'],
  ['2 / 3', '3 / 2', '3 / 2', '2 / 3'],
  ['3 / 2', '4 / 5', '2 / 3', '3 / 2'],
];

export default function PhotoGridSkeleton() {
  return (
    <div className={gridStyles.grid}>
      <div className={styles.columns}>
        {COLUMNS.map((shapes, column) => (
          <div key={column} className={styles.column}>
            {shapes.map((aspectRatio, row) => (
              <SkeletonBlock key={row} style={{ aspectRatio }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
