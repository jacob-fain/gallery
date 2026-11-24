import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import headingStyles from '../PageHeading/PageHeading.module.css';
import styles from './Skeleton.module.css';

// A load that finishes sooner than this shows nothing rather than flashing
// the placeholders for a frame or two.
export const SKELETON_DELAY_MS = 250;

// Stands in for a page while its data loads, laid out like the page so the
// content lands where the placeholders were.
export function DelayedSkeleton({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SKELETON_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className={styles.root} role="status" aria-label="Loading" aria-busy="true">
      {shown && <div aria-hidden="true">{children}</div>}
    </div>
  );
}

// PageHeading's box, with bars for its title and, on a gallery, its count.
export function HeadingSkeleton({ gallery = false }: { gallery?: boolean }) {
  return (
    <div className={gallery ? headingStyles.galleryHeader : headingStyles.indexHeader}>
      <div className={`${styles.block} ${styles.title}`} data-skeleton />
      {gallery && <div className={`${styles.block} ${styles.count}`} data-skeleton />}
    </div>
  );
}

export function SkeletonBlock({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={className ? `${styles.block} ${className}` : styles.block} style={style} data-skeleton />
  );
}
