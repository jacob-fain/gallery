import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Gallery } from '../types';
import { CoverImage } from './HomeImages';
import { coverRatio, coverSizes } from './homeLayout';
import styles from './Home.module.css';

function GalleryDoor({ gallery }: { gallery: Gallery }) {
  const ratio = coverRatio(gallery);
  return (
    <Link
      to={`/g/${gallery.slug}`}
      className={styles.door}
      style={{ '--ratio': ratio.toFixed(4) } as React.CSSProperties}
    >
      <CoverImage gallery={gallery} sizes={coverSizes(ratio)} />
      <span className={styles.doorCaption}>
        <span className={styles.doorTitle}>
          {gallery.title}{' '}
          <span className={styles.captionArrow} aria-hidden="true">
            &#8594;
          </span>
        </span>
        {gallery.photoCount !== undefined && (
          <span className={styles.doorCount}>
            {gallery.photoCount} {gallery.photoCount === 1 ? 'photo' : 'photos'}
          </span>
        )}
      </span>
    </Link>
  );
}

/**
 * The galleries as one row of covers at a shared height, whole and uncropped,
 * scrolled sideways when they do not all fit. The arrows show only while
 * there is more to scroll that way; touch and trackpads scroll it directly.
 */
export default function HomeGalleries({ galleries }: { galleries: Gallery[] }) {
  const strip = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    // A pixel of slack: scroll positions are fractional on scaled screens.
    setMore({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
  }, []);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    // Missing in some test environments; the scroll handler still measures.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // Covers load after the first measure and widen the row.
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [measure, galleries]);

  const page = (direction: 1 | -1) => {
    const el = strip.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <div className={styles.stripFrame}>
      <div ref={strip} className={styles.doors} onScroll={measure}>
        {galleries.map((gallery) => (
          <GalleryDoor key={gallery.id} gallery={gallery} />
        ))}
      </div>
      {more.left && (
        <button
          type="button"
          className={`${styles.stripArrow} ${styles.stripPrev}`}
          aria-label="Scroll galleries left"
          onClick={() => page(-1)}
        >
          &#8592;
        </button>
      )}
      {more.right && (
        <button
          type="button"
          className={`${styles.stripArrow} ${styles.stripNext}`}
          aria-label="Scroll galleries right"
          onClick={() => page(1)}
        >
          &#8594;
        </button>
      )}
    </div>
  );
}
