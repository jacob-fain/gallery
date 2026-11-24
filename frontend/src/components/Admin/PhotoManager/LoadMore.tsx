import { useEffect, useRef } from 'react';
import styles from './LoadMore.module.css';

interface LoadMoreProps {
  loaded: number;
  total: number;
  loading: boolean;
  // The last page failed: wait for the button instead of retrying on scroll.
  failed: boolean;
  onLoad: () => void;
  className?: string;
}

/**
 * The end of a paged photo list. Scrolling near it loads the next page, and
 * the button does the same for keyboards and for a failed page.
 */
export default function LoadMore({ loaded, total, loading, failed, onLoad, className }: LoadMoreProps) {
  const ref = useRef<HTMLDivElement>(null);
  const more = loaded < total;

  // Re-observed after every page: the observer reports only changes, and a
  // short page can leave the sentinel in view with more still to load.
  useEffect(() => {
    const el = ref.current;
    if (!more || failed || !el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoad();
      },
      { rootMargin: '800px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [more, failed, onLoad, loaded]);

  if (!more) return null;

  return (
    <div ref={ref} className={`${styles.loadMore} ${className ?? ''}`}>
      <span>
        Showing {loaded} of {total}
      </span>
      <button type="button" className={styles.loadMoreBtn} onClick={onLoad} disabled={loading}>
        {loading ? 'Loading...' : failed ? 'Retry' : 'Load more'}
      </button>
    </div>
  );
}
