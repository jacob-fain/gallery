import { Link } from 'react-router-dom';
import type { Gallery } from '../../types';
import { derivedImages } from '../../utils/imageSizes';
import styles from './GalleryCard.module.css';

interface GalleryCardProps {
  gallery: Gallery;
}

// Matches the galleries grid (Galleries.module.css): one column on phones,
// otherwise at most about half the screen per card.
const COVER_SIZES = '(max-width: 640px) 100vw, 50vw';

export default function GalleryCard({ gallery }: GalleryCardProps) {
  const candidates = derivedImages({
    width: gallery.coverWidth ?? 0,
    height: gallery.coverHeight ?? 0,
    thumbnailUrl: gallery.coverUrl ?? undefined,
    webUrl: gallery.coverWebUrl ?? undefined,
  });
  // Older responses without cover dimensions still show the thumbnail.
  const src = candidates[0]?.src ?? gallery.coverUrl;

  return (
    <Link to={`/g/${gallery.slug}`} className={styles.card}>
      <div className={styles.imageWrapper}>
        {src ? (
          <img
            src={src}
            srcSet={candidates.map((c) => `${c.src} ${c.width}w`).join(', ') || undefined}
            sizes={candidates.length ? COVER_SIZES : undefined}
            alt={gallery.title}
            className={styles.image}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className={styles.placeholder} aria-hidden="true" />
        )}
        <div className={styles.overlay}>
          <span className={styles.title}>{gallery.title}</span>
        </div>
      </div>
    </Link>
  );
}
