import { Link } from 'react-router-dom';
import type { Gallery } from '../../types';
import styles from './GalleryCard.module.css';

interface GalleryCardProps {
  gallery: Gallery;
}

export default function GalleryCard({ gallery }: GalleryCardProps) {
  // Use actual cover URL, or placeholder if no photos yet
  const coverUrl = gallery.coverUrl || `https://placehold.co/600x400/1a1a1a/ffffff?text=${encodeURIComponent(gallery.title)}`;

  return (
    <Link to={`/g/${gallery.slug}`} className={styles.card}>
      <div className={styles.imageWrapper}>
        <img src={coverUrl} alt={gallery.title} className={styles.image} />
        <div className={styles.overlay}>
          <span className={styles.title}>{gallery.title}</span>
        </div>
      </div>
    </Link>
  );
}
